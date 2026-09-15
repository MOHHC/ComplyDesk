# ComplyDesk

## What it is

Small companies chasing SOC 2 mostly run compliance on a spreadsheet: a list of controls, a folder of screenshots labeled "evidence," and someone's memory of what's expired. ComplyDesk replaces that spreadsheet with a proper multi-tenant register. Each company gets a workspace seeded with a standard control set, uploads evidence against each control, and gets a dashboard of what's covered, what's missing, and what's about to expire. An AI layer on top reads uploaded evidence well enough to auto-classify it against a control, and reads an uploaded policy document well enough to flag which controls it doesn't actually cover.

The interesting part of building this wasn't the CRUD. It was making "your data never leaks into another tenant's response" true by construction instead of by convention, in a single shared Postgres database.

## Demo & stack

**Live demo:** [complydesk.online](https://complydesk.online) → **Try the demo**, or go straight to [demo.complydesk.online/login](https://demo.complydesk.online/login?demo=1) (`demo@complydesk.online` / `ComplyDeskDemo123!`, both public on purpose). No signup needed — the tenant is pre-loaded with real data. Sign up instead and you get your own real subdomain (`<yourslug>.complydesk.online`); tenant resolution runs on it exactly the way it would for a real customer, not through a query param.

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19 — deployed on Vercel |
| API | NestJS 11 (CommonJS + Jest — Nest 12 ships ESM-only, which classic Jest can't consume) — deployed on Render |
| Database | PostgreSQL on [Neon](https://neon.tech), via Prisma 7 (`pg` driver adapter) — same production branch the API talks to locally |
| Vector search | pgvector, `ivfflat` index, 384-dim embeddings |
| Object storage | Neon Object Storage (S3-compatible), presigned URLs only |
| AI | Gemini (vision + embeddings) and Groq (text reasoning) behind one interface — see below |
| Monorepo | npm workspaces (`apps/web`, `apps/api`, `packages/shared`) |

No Redis, despite what the rate limiter below might suggest. See [Next steps](#what-id-do-differently--next-steps).

### About the demo tenant

Everything in it is real, pre-generated data — an 18-control set, evidence uploaded and classified by the actual Gemini pipeline (including one file classified `FAILED` because it genuinely tripped Gemini's free-tier rate pacer mid-seed, left as-is rather than faked, and one deliberately irrelevant upload the AI correctly declined to match to anything), a policy document actually chunked and embedded, and a gap-analysis report from a real Groq run with real citations. None of it was hand-inserted into the database. Worth two minutes: the readiness **Dashboard**, then **Controls** (click one for its evidence + AI classification), then **Gap Analysis** for the citation-backed report, then **Tasks**.

Uploading evidence, uploading a policy document, retrying a classification, and re-running gap analysis are all disabled on this one tenant (`Tenant.isDemo`, enforced server-side by `DemoReadOnlyGuard` on each of those four routes) — not rate-limited or reset on a timer, just off — so one visitor's clicking can't spoil the next visitor's tour. Everything else (browsing, reviewing an AI suggestion, creating/reassigning tasks) stays fully interactive.

## Architecture

```
                        Browser (tenant subdomain, e.g. acme.complydesk.online)
                                        │
                                        │  fetch(..., headers: { X-Tenant-Slug })
                                        ▼
                        ┌───────────────────────────────┐
                        │        NestJS middleware        │
                        │                                 │
                        │  1. TenantMiddleware            │
                        │     Host subdomain, else         │
                        │     X-Tenant-Slug header  ───►  cls.tenantId
                        │                                 │
                        │  2. TenantTransactionMiddleware │
                        │     opens one Prisma tx for the │
                        │     rest of the request, runs    │
                        │     SELECT set_config(           │
                        │       'app.tenant_id', id, true) │
                        │     (SET LOCAL semantics)        │
                        │                                 │
                        │  nestjs-cls (AsyncLocalStorage)  │
                        │  carries {tenantId, userId,      │
                        │  role, tenantTx} through every    │
                        │  guard / interceptor / handler   │
                        │  for this request, with zero      │
                        │  prop-drilling                    │
                        └───────────────┬─────────────────┘
                                        │
                     JwtAuthGuard ──► RolesGuard ──► AuditInterceptor
                                        │  (every mutation, best-effort,
                                        │   same transaction as the write)
                                        ▼
                        ┌───────────────────────────────┐
                        │   Postgres (Neon), role:        │
                        │   app_runtime — NOBYPASSRLS      │
                        │                                 │
                        │   FORCE ROW LEVEL SECURITY on    │
                        │   every tenant-owned table:       │
                        │   Membership, Control, Evidence,  │
                        │   Task, AuditEvent, PolicyDocument│
                        │   PolicyChunk, GapAnalysisRun/Result,│
                        │   EvidenceClassification, Tenant, │
                        │   User (narrower policies)        │
                        │                                 │
                        │   USING (tenantId = current_     │
                        │   setting('app.tenant_id'))       │
                        └───────────────┬─────────────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                            ▼
                 GeminiAiProvider              GroqAiProvider
                 classifyEvidence (vision)     checkControlCoverage
                 embed (local pgvector input)  (text-only gap analysis)
```

Everything below `TenantTransactionMiddleware` (guards, interceptors, service code, route handlers) runs inside one transaction that already has `app.tenant_id` set. A service method that forgets to add `WHERE tenantId = ...` still doesn't leak. RLS filters it at the database, regardless of what the application code remembered to write.

## The hardest problem: tenant isolation

The whole design rests on one claim: **an application bug in a service method cannot leak another tenant's row.** Getting from "we usually filter by tenant" to something you can actually stand behind took a few Postgres and Neon specifics most CRUD apps never touch.

**`FORCE ROW LEVEL SECURITY`, and the role it actually binds.** `ENABLE ROW LEVEL SECURITY` alone doesn't restrict the table's *owner*. Postgres exempts owners from RLS by default, which quietly defeats the whole point if your app connects as the same role that ran the migrations. The app connects as a separate, least-privilege `app_runtime` role instead: `LOGIN`, `NOBYPASSRLS`, `GRANT SELECT/INSERT/UPDATE/DELETE` on exactly the tables it needs, no DDL. Migrations run as the table owner. `FORCE ROW LEVEL SECURITY` is what makes the policies bind even against a hypothetical owner-role connection, though in practice `app_runtime` never hits that problem, since it isn't the owner to begin with.

Two Neon-specific footguns surfaced writing this, both documented inline in the migration rather than left as tribal knowledge:
- Roles created through Neon's own console/CLI (`neon roles create`) get `BYPASSRLS` by default, which makes them permanently un-constrainable by any policy regardless of `FORCE`. `app_runtime` is created with plain SQL (`CREATE ROLE`) instead, which defaults to `NOBYPASSRLS` and (as of Postgres 16) gives the creating role `ADMIN OPTION` on it — that's what lets the following `ALTER ROLE ... NOBYPASSRLS` succeed at all.
- `CREATE ROLE` is cluster-wide, not database-scoped. `prisma migrate dev` replays every migration against a throwaway shadow database first. That creates the role for real, cluster-wide, before the migration ever reaches the actual target database. Every statement in the RLS migrations is written idempotent (`DO $$ ... IF NOT EXISTS`, `DROP POLICY IF EXISTS`) specifically so a second `CREATE ROLE app_runtime` colliding with itself doesn't break the migration.

**`SET LOCAL`, not `SET`.** The tenant scope for a request is set via `SELECT set_config('app.tenant_id', <id>, true)`. The third argument is what makes it transaction-local (`SET LOCAL` semantics), not a plain session-wide `SET`. This matters specifically because of connection pooling: a plain `SET` would persist on the underlying connection after the transaction commits, and the next request Prisma hands that pooled connection to would silently inherit the previous tenant's context. `set_config`'s value is also passed as a bound parameter rather than interpolated into the SQL string, since `SET LOCAL` itself has no parameter-placeholder syntax in Postgres. It's the one place tenant id touches raw SQL directly, so it's the one place that actually matters.

**The `::uuid` cast is load-bearing, not decoration.** Every policy reads `"tenantId"::uuid = current_setting('app.tenant_id')::uuid`. On a *fresh* connection, an unset `app.tenant_id` makes `current_setting()` throw, which is exactly what should happen if a request somehow reaches an RLS-protected table with no tenant context wired. But on a *pooled* connection where an earlier transaction already set the parameter once, Postgres remembers the parameter exists, and `current_setting()` returns an empty string instead of throwing on the next transaction, even though `SET LOCAL` correctly reset its *value*. A plain text comparison against `''` would silently read as "this tenant has zero rows": a wiring bug that looks exactly like an empty account. The `::uuid` cast turns that empty string back into a loud, unambiguous error instead. Both behaviors (throws on a genuinely fresh connection, throws on the pooled-empty-string case) are asserted directly in the isolation suite, not just reasoned about in a comment.

**`Tenant` and `User` don't fit the same policy shape as everything else**, because neither has a `tenantId` column to compare against: `Tenant` *is* the tenant, and `User` is a global identity that only relates to a tenant through `Membership`. `Tenant` gets `SELECT` left open (`USING (true)`) deliberately, since `TenantMiddleware` has to look a tenant up by slug *before* any `app.tenant_id` context can exist — a single `FOR ALL` policy referencing `current_setting()` here would make every request unable to resolve a tenant at all. Writes stay scoped (`WITH CHECK` as well as `USING`, so an `UPDATE` can't pass the read check on your own row and then rewrite `id` to point at someone else's). `User` scopes both reads and writes through an `EXISTS` subquery against `Membership`, with one genuinely non-obvious finding along the way: Postgres applies a table's `SELECT` policy to `UPDATE`/`DELETE` whenever the statement's `WHERE` clause reads existing columns, which any qualified `WHERE` does. So a *qualified* cross-tenant write (`UPDATE ... WHERE id = <other tenant's user>`) was already blocked to 0 rows by the `SELECT` policy alone, verified on Neon's own test branch. The gap the `Membership` write-policy actually closes is the *unqualified bulk write*: `UPDATE "User" SET name = 'x'` with no `WHERE` at all, which affected 2 rows across 2 tenants under a naive `USING (true)`, and exactly 1 under the membership-scoped policy.

The full reasoning lives in the migrations themselves: [`20260831140238_add_rls_and_app_runtime_role`](apps/api/prisma/migrations/20260831140238_add_rls_and_app_runtime_role/migration.sql) and [`20260831201500_rls_tenant_and_user`](apps/api/prisma/migrations/20260831201500_rls_tenant_and_user/migration.sql). Every claim above is backed by a test in [`apps/api/test/rls-isolation.e2e-spec.ts`](apps/api/test/rls-isolation.e2e-spec.ts): roughly 30 cases covering cross-tenant SELECT/UPDATE/DELETE, `WITH CHECK` forgery on INSERT, a service method with no tenant filter in its own code (still returns nothing cross-tenant, since RLS catches what the code forgot), the pooled-empty-string throw, and per-table coverage of every RLS-protected table including the five AI-layer tables added later.

## Other engineering decisions

**Two AI providers, split by what they're actually good at, not one vendor for everything.** `classifyEvidence` (needs vision, for photo/scan evidence) and `embed` stay on Gemini; `checkControlCoverage` (pure text reasoning against policy chunks) moved to Groq. Both sit behind one `AiProvider` interface via a `CompositeAiProvider` that routes internally. Callers have no idea two vendors are involved. The move happened because Gemini's free tier is roughly 4 RPM and 20 requests a day, and a single gap-analysis run costs about 18 of those: most of a day's budget in one click. The first model picked for Groq (`llama-3.3-70b-versatile`) turned out to be retired, discovered by 404s on a real run against a real API key rather than by reading changelogs; `openai/gpt-oss-120b` replaced it after confirming it was actually in the account's live model list. A second real run against the corrected model finished in about 51 seconds with 0 degraded controls, 0 errors, 0 429s. The rate limit was then re-derived from that live data (Groq's confirmed ~1,000 req/day vs. Gemini's ~20/day) rather than left at the old Gemini-sized number. Retired models that still show up in a provider's own docs are an annoying, recurring class of bug — you don't find them until you actually make the call.

Tenant resolution has a similar honesty problem worth naming directly. It's Host-subdomain first (`acme.complydesk.online` → tenant `acme`), but browsers never let JavaScript override the `Host` header on `fetch`/`XHR`, so a browser calling a non-subdomained API URL can never resolve a tenant via `Host` alone. `X-Tenant-Slug`, computed client-side from `window.location.hostname`, is the fallback the web app actually sends. The textbook production answer is a reverse proxy that terminates the real subdomain and forwards it as `Host` (or an equivalent trusted header) to the API, so tenant resolution never depends on a client-supplied value at all. That's not implemented here. The header fallback isn't itself a security hole — `JwtAuthGuard` still requires a real `Membership` row for whichever tenant gets resolved, so claiming an arbitrary slug gains nothing without a valid token for a member of it — but it does mean tenant resolution trusts an untrusted client, for local dev and for any deployment that isn't behind that proxy. I left it this way on purpose, to keep scope on the core multi-tenancy and RLS work rather than infra.

Audit logging runs inside the request's own tenant transaction, not beside it. `AuditInterceptor` is a global `APP_INTERCEPTOR` that records every mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) to `AuditEvent`: actor, action, target, a computed `{field: {before, after}}` diff, using the same `tenantTx` the request's handler is writing through. That buys two things for free: the audit row shares the mutation's atomicity (a write and its audit row commit or roll back together, nothing to keep in sync by hand), and it shares RLS context (an audit interceptor literally cannot write into another tenant's log, by the same mechanism that protects everything else). It's deliberately best-effort: an audit-write failure gets logged and swallowed, never allowed to fail or mask the original request's result. It has two known blind spots by construction, not oversight — a `RolesGuard` rejection never reaches an interceptor at all in Nest's pipeline, so denied attempts show up in ordinary request logs, not here; and signup writes its own `audit.signup` row by hand, since no tenant transaction exists yet at the point a tenant is first created.

## Lessons learned (the annoying kind)

A few bugs worth a line each, because none of them were obvious from the symptom:

- **Login failing right after signup, only when email case differed.** Reported as "same exact credentials, wrong password." Root cause had nothing to do with bcrypt or the RLS changes that had just landed on `User`, the obvious suspect. `User.email` had no case normalization anywhere, and Postgres text equality is case-sensitive, so `Owner@x.test` stored at signup and `owner@x.test` typed at login were just two different strings. Fixed at the DTO boundary (`@Transform` trim+lowercase) *and* independently at the schema (`CHECK (email = lower(email))`), so no future caller, whether a script or another endpoint, can reintroduce it either. Chasing it down surfaced a second, unrelated bug: none of the e2e tests were actually running through the app's real `ValidationPipe`/CORS setup, because every e2e spec built its Nest app by hand and skipped `main.ts`'s `bootstrap()` entirely. DTO validation had been silently inert in every e2e test in the project up to that point, passing for the wrong reason.
- **`nest build` silently producing an empty `dist/`.** `deleteOutDir` wiped `dist/` before every build, but tsc's incremental build cache lived *outside* `dist/`. On a second build, tsc trusted its still-intact cache, decided nothing changed, and skipped recompiling, except the `dist/` that cache described no longer existed. Exit code 0, zero files written, no error anywhere. Fixed by moving the cache file inside `dist/` so it always gets wiped together with the output it describes.
- **`X-Tenant-Slug` itself** exists because of a bug that looked like a token problem: `/auth/me` 403'd unconditionally from the web app with a demonstrably valid token, because Host-based resolution can never see a tenant on a browser request in the first place. Diagnosing it also surfaced two more browser-only bugs no unit test caught: CORS only allowed the exact `localhost:3000` origin, so every tenant subdomain failed preflight before reaching the app, and Chrome's HTML `pattern` attribute parses under Unicode-set regex semantics, where an unescaped trailing hyphen in a character class throws instead of matching. That silently broke the signup form's slug input in exactly one browser.
- **Deploying to Render produced a build failure that never happens locally**, for a similar reason to the `dist/` bug above. `apps/api`'s `build` script was just `nest build`, with no `prisma generate` anywhere in the chain. Locally that's invisible. The generated client has been sitting in `node_modules/@prisma/client` since the last time anyone ran `npm install` on this machine, so nothing forces regeneration. Render's build container starts from nothing, so the client was a stub: every Prisma-generated export (`Role`, `TaskStatus`, even `PrismaClient`'s own `$connect`/`$disconnect`) was missing, roughly 37 TypeScript errors. I reproduced it locally first, by deleting the generated client and rerunning the old build to get the identical error signature, then fixed it by making `build` run `prisma generate && nest build`.
- **Deploying `apps/web` to Vercel hit a real monorepo gap**, not a config typo. Vercel's CLI only uploads whatever directory you deploy *from*. Linking and deploying from inside `apps/web` uploaded exactly that directory: 37 files, no `packages/shared`, no way for the install step's `cd ../..` to reach anything real. The fix wasn't the dashboard's "Root Directory" setting, since nothing in the CLI sets that non-interactively; it was a `vercel.json` at the *repo root*, deploying from there, with explicit `framework`/`buildCommand`/`outputDirectory` fields standing in for the auto-detection that only works when the app lives at the deployment root.

## What I'd do differently / next steps

1. **Reverse proxy for tenant resolution.** Replace the `X-Tenant-Slug` client-supplied fallback with a proxy that terminates the real subdomain and forwards a trusted header. That removes the one place tenant identity still depends on what the client claims, rather than just what it's authorized for.
2. **Redis-backed rate limiting.** `TenantRateLimitGuard` is an in-memory fixed window, scoped to one process — a known, accepted limit, not a surprise. It doesn't hold across a multi-instance deployment. I'd rather build the shared-state version once it actually matters than guess at it now.
3. **Revisit the `Tenant`/`User` RLS shape once the product needs more from either table.** Both work today because of what they *are* — `Tenant` has no `tenantId` column to filter on, `User` is a global identity scoped only through `Membership` — but that also means their policies are structurally different from every other table's, and easy to get subtly wrong if a future column or endpoint assumes the standard `tenantId`-column shape. Worth a deliberate second look before either table grows new tenant-facing surface area.
4. **Replace the hand-rolled root `vercel.json` with a real Root Directory setting.** It works, and it's honestly documented above, but it's a workaround for a CLI gap (no non-interactive way to set Root Directory on an existing project), not the intended way to run a Vercel monorepo deploy. Worth revisiting once `vercel link --repo` (currently alpha, and didn't behave non-interactively when I tried it here) stabilizes, or just by setting it once by hand in the dashboard.

## Local setup

```bash
npm install
npm run build -w packages/shared

# apps/api/.env (gitignored) needs at minimum:
#   DATABASE_URL / DATABASE_URL_UNPOOLED   (Neon connection strings)
#   APP_RUNTIME_DATABASE_URL               (app_runtime role, RLS-scoped)
#   JWT_SECRET
#   GEMINI_API_KEY, GROQ_API_KEY
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 / AWS_REGION
#     (Neon Object Storage, S3-compatible)
#   WEB_ORIGIN

npm run dev   # apps/api on :3001, apps/web on :3000, together
```

Visit a tenant subdomain locally, e.g. `acme.localhost:3000`. Each app also runs standalone (`npm run dev -w apps/api` / `-w apps/web`). Full test suite: `npm test` (unit) and the e2e specs under `apps/api/test/` (Prisma migrations run against a real Neon branch, no mocked database).
