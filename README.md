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
