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
