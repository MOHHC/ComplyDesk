# ComplyDesk

npm workspaces monorepo:

- `apps/web` — Next.js 16 (App Router) frontend, port 3000.
- `apps/api` — NestJS 11 (CommonJS + Jest — Nest 12 ships ESM-only, incompatible
  with classic Jest) + Prisma API, port 3001. Only this app talks to Postgres.
- `packages/shared` — shared TypeScript types (`Role`, auth DTOs), built to `dist/` —
  run `npm run build -w packages/shared` after editing it, before restarting the apps.

## Why npm workspaces (not pnpm/Turborepo)

pnpm and Turborepo aren't installed in this environment, and at 2 apps + 1 shared
package the build-caching Turborepo gives isn't paying for its setup cost yet. npm
workspaces is zero extra install and already proven working here. Revisit Turborepo
if build/test times become a real pain as the repo grows.

## Setup

    npm install
    npm run build -w packages/shared
    npm run dev          # runs apps/api (:3001) and apps/web (:3000) together

Each app also runs standalone: `npm run dev -w apps/api` / `npm run dev -w apps/web`.

## Neon

Linked to Neon project **ComplyDesk** (`restless-water-11477407`) in org **Mohamad**
(`org-royal-boat-08830339`). Branches: `production` (default) and `test` (for e2e
tests, branched off `production`). `.neon` at the repo root pins the link (git-ignored).

## Multi-tenancy

Tenant is resolved from the request's `Host` subdomain (e.g. `acme.localhost:3000` →
tenant `acme`); user identity from a JWT bearer token. Both combine into a per-request
context (`{ tenantId, userId, role }`) via `nestjs-cls`.

Tenant resolution uses a header-based fallback (`X-Tenant-Slug`) for local dev and
direct API calls; a reverse proxy forwarding the browser's real subdomain as the
`Host` header is the documented production-correct approach, not implemented here to
keep scope focused on the core multi-tenancy architecture.

## Row-Level Security

Every tenant-owned table (`Membership`, `Control`, `Evidence`, `Task`, `AuditEvent`,
and `Tenant`/`User` via narrower policies — see the migrations for the reasoning
specific to each) has Postgres RLS enabled and forced, scoped to
`current_setting('app.tenant_id')`. The running app connects as `app_runtime`, a
least-privilege role with no schema privileges and `NOBYPASSRLS`; migrations run as
the table owner. `TenantTransactionMiddleware` opens one transaction per request and
sets `app.tenant_id` via `SET LOCAL` semantics before anything else runs. See
`apps/api/prisma/migrations/*_add_rls_*` and `*_rls_tenant_and_user` for the full
reasoning, including two Neon-specific defaults that had to be worked around
(`BYPASSRLS` defaulting on for CLI-created roles, and a shadow-database side effect
from `CREATE ROLE` being cluster-wide).

## Core features (Phase 3)

- **Controls**: each tenant is seeded on signup with the 18 controls in
  `seeds/controls.json`. `GET /controls` filters by `category` and by a computed
  `status` (`no_evidence` / `has_evidence` / `evidence_expired`, based on the most
  recent Evidence row's `collectedAt` + the control's `refreshIntervalDays`).
- **Evidence**: `POST /controls/:id/evidence` uploads a file to Neon Object Storage
  (a private, per-branch S3-compatible bucket) and writes a metadata row linking it
  to the control. Downloads are always via a short-lived presigned URL generated on
  request — nothing is ever a stored public link.
- **Tasks**: `POST /tasks` assigns a control to a member with a due date.
  `PATCH /tasks/:id/status` is also open to the assignee themselves (not just
  OWNER/ADMIN), restricted to their own tasks.
- **Dashboard**: `GET /dashboard/readiness` returns % of controls with valid
  evidence, count missing evidence, and count expiring within 30 days.
- **RBAC**: `Role` is `OWNER | ADMIN | CONTRIBUTOR | AUDITOR`, enforced by
  `RolesGuard` + a `@Roles()` decorator (paired with `JwtAuthGuard`, in that order).
  A route with no `@Roles()` is open to any authenticated member. Matrix:
  | Action | OWNER | ADMIN | CONTRIBUTOR | AUDITOR |
  |---|---|---|---|---|
  | View controls/evidence/tasks/dashboard | ✅ | ✅ | ✅ | ✅ |
  | Upload evidence | ✅ | ✅ | ✅ | ❌ |
  | Create/reassign tasks | ✅ | ✅ | ❌ | ❌ |
  | Update status of a task assigned to you | ✅ | ✅ | ✅ | ❌ |
- **Audit log**: `AuditInterceptor` (registered globally) records every mutating
  request (POST/PUT/PATCH/DELETE) to `AuditEvent` — tenant, actor, action, target
  resource, and a `{ field: { before, after } }` diff — inside the same transaction
  as the mutation itself, so a write and its audit row commit or roll back together.
  Two limitations, both by construction rather than oversight: a Guard rejection
  (e.g. RBAC 403) never reaches an interceptor in Nest's pipeline, so denied
  attempts aren't logged here; and signup writes its own `auth.signup` row directly,
  since no tenant transaction exists yet for the interceptor to use.

## AI layer (Phase 5)

Evidence classification and gap analysis are backed by an `AiProvider` interface
(`apps/api/src/ai/ai-provider.interface.ts`), selected via the `AI_PROVIDER` DI
token: `ClaudeAiProvider` (Claude for reasoning, a local `all-MiniLM-L6-v2` model
for embeddings) in the running app, `FakeAiProvider` in every automated test. Every
AI-touching e2e spec overrides `AI_PROVIDER` at the Nest DI level, so
`ClaudeAiProvider` — and the Anthropic client it constructs — is never instantiated
during `npm test` / `npm run test:e2e`; `apps/api/.env.test` also carries no
`ANTHROPIC_API_KEY`. To exercise the real provider by hand, add
`ANTHROPIC_API_KEY=<key>` to `apps/api/.env` (gitignored, not committed) — nothing
in the automated suites depends on it.

Policy documents are chunked and embedded locally into `PolicyChunk.embedding`
(pgvector, 384 dims), searched via an `ivfflat` index (`lists = 100`). RLS filters
matching rows down to the current tenant *after* that index has already picked its
candidates, so a tenant holding a small share of the shared table could otherwise
get back too few (even zero) results despite having relevant content.
`GapAnalysisService.run()` works around this by setting `ivfflat.probes = 100`
(`SET LOCAL`, transaction-scoped) — equal to `lists`, i.e. every list gets probed,
turning the search into an exhaustive scan with exact recall. This was a deliberate
choice given gap analysis's cost profile (on-demand, capped at 5 runs/hour/tenant,
~18 of these queries per run): the tradeoff is that per-query cost now scales with
the total `PolicyChunk` row count **across all tenants**, not just the current
one. As that shared table grows, the first symptom will be gap-analysis runs
aborting on the enclosing transaction's 75s timeout
(`gap-analysis-transaction.middleware.ts`) rather than anything that obviously
points at the vector index. If gap analysis ever needs to get faster, this is the
first thing to revisit; per-tenant partitioning of `PolicyChunk` and switching the
index to HNSW (which tolerates filtered search better than ivfflat) were both
deliberately deferred as unnecessary at current scale.

### Production migration follow-up (not yet applied)

The AI-layer schema (`apps/api/prisma/migrations/20260901120000_ai_layer`) and its
follow-up adding the missing `tenantId -> Tenant` foreign keys
(`20260901150000_ai_layer_tenant_fk`) have been applied to the Neon `test` branch
only. Applying them to `production` is a deliberate, separate step gated on an
explicit go-ahead, not something to run automatically:

1. `npx prisma migrate deploy` against `production`'s `DATABASE_URL_UNPOOLED`.
2. Re-run the same read-only RLS-state verification query used on `test` (see the
   AI-layer migration's own verification steps) against `production`.

Two things worth knowing before giving that go-ahead:

- **Locking/validation cost.** The `tenantId` FK migration adds five foreign keys.
  Adding a foreign key in Postgres takes a `SHARE ROW EXCLUSIVE` lock on both
  tables (blocks concurrent writes, not reads) and validates every existing row in
  the referencing table. That was instant against a test branch holding 0-2 rows
  per table; against a populated production `PolicyChunk` (one row per document
  chunk, each carrying a 384-dim embedding) it will not be — plan for a low-traffic
  window. Prisma still runs the whole migration file as one transaction, so it's
  atomic: it cannot leave the database in a half-applied state even if it has to
  wait a while for the lock.
- **`citationChunkId` gets nulled, not just orphans deleted.** The same
  migration's orphan cleanup deletes `PolicyChunk`/`PolicyDocument`/`GapAnalysisRun`
  rows whose `tenantId` matches no `Tenant` (plus a pre-flight guard that aborts
  instead of deleting if any live tenant's row would be caught in the blast radius
  of a *pre-existing* cascade — see the migration file's own comments).
  `GapAnalysisResult.citationChunkId` references `PolicyChunk` with `ON DELETE SET
  NULL`, so if a live tenant's `GapAnalysisResult` happens to cite a chunk that gets
  deleted as an orphan, its citation is nulled rather than the result row being
  touched. Reasonable — the citation was already dangling — but worth knowing
  before running it, not discovering after.

### `prisma migrate diff` reports drift — one half benign, one half real

Running `prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma
--script` against the database always reports a `DropIndex` on
`PolicyChunk_embedding_idx` with no corresponding re-create, plus a churn-style
drop-and-recreate of several unrelated foreign keys (`AuditEvent`,
`EvidenceClassification`, `PolicyDocument`, `PolicyChunk`, `GapAnalysisRun`,
`GapAnalysisResult`) with byte-identical `ON DELETE` clauses. These are two
different things:

- The **index drop** is benign and permanent: `embedding` is declared
  `Unsupported("vector(384)")` because Prisma has no native vector type, so
  `schema.prisma` cannot express an `ivfflat` index at all. The diff engine sees
  an index in the database that the target schema has no way to represent and
  always proposes dropping it. Never accept that half of the diff — it has no
  corresponding "add" to restore the index, since Prisma can't generate one.
- The **foreign-key churn is real, low-severity drift**, not a tooling artifact:
  every hand-written `CREATE TABLE`/`ADD CONSTRAINT` for those foreign keys
  specifies `ON DELETE` but omits `ON UPDATE`, leaving Postgres's default
  (`NO ACTION`) in place, while `schema.prisma`'s relations specify `onDelete`
  without an explicit `onUpdate`, which makes Prisma default to `onUpdate:
  Cascade`. The database and the schema genuinely disagree about `ON UPDATE`
  on eleven foreign keys (none of which matter in practice, since none of the
  referenced columns are primary keys that are ever updated). Left alone, a
  future `prisma migrate dev` could turn this into a real migration that drops
  and recreates all eleven constraints — each drop taking a lock — for no
  functional benefit. Worth a deliberate follow-up (most likely: add explicit
  `onUpdate: Cascade` or `onUpdate: NoAction` to the affected relations in
  `schema.prisma` to match whichever behavior is actually intended, so the diff
  clears without touching the database at all) but not fixed here.
