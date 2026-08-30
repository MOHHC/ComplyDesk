# ComplyDesk Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a two-app npm-workspaces monorepo (Next.js web app, NestJS API) backed by Neon Postgres (project **ComplyDesk**, `restless-water-11477407`, org **Mohamad**, `org-royal-boat-08830339`), with a Prisma schema for tenants/users/memberships/controls/evidence/tasks, email+password auth, and subdomain-based multi-tenancy that stores `{ tenantId, userId, role }` per request via `nestjs-cls`.

**Architecture:** `apps/api` (NestJS + Prisma) is the only service that talks to Postgres; `apps/web` (Next.js App Router) is a thin client that calls the API over HTTP. `packages/shared` holds TypeScript types (auth DTOs, `Role`) consumed by both, built to plain JS so neither app needs to transpile a workspace package at runtime. Tenant identity is resolved from the `Host` header subdomain (e.g. `acme.localhost:3000` → tenant `acme`) in middleware; user identity comes from a JWT bearer token verified in a guard. Both converge into one `AsyncLocalStorage`-backed request context via `nestjs-cls`, so any service can read `cls.get('tenantId')` without threading it through every function signature.

**Tech Stack:** TypeScript everywhere, Node.js 22, npm workspaces (no pnpm/yarn available in this environment), Next.js (App Router) + React, NestJS + Prisma + `@prisma/client`, Neon Postgres (pooled + direct connection strings), `nestjs-cls` for request-scoped context, `bcrypt` for password hashing, `@nestjs/jwt` for token issuance/verification, Jest for `apps/api` unit/e2e tests, Vitest + Testing Library for the one `apps/web` component test.

## Global Constraints

- Package manager is **npm** (workspaces), not pnpm/yarn — neither is installed in this environment.
- Node.js 22.x, TypeScript throughout (no `.js` source files).
- Neon project is **fixed**: org `org-royal-boat-08830339`, project `restless-water-11477407` (`ComplyDesk`, region `aws-us-east-2`, single branch `production`, database `neondb`). Do not create a new Neon project.
- `apps/api` is the only service with a `DATABASE_URL` / Prisma client. `apps/web` never talks to Postgres directly — it calls `apps/api` over HTTP, per the `neon` skill's recommended architecture.
- Migrations run against the **direct/unpooled** connection string (`DATABASE_URL_UNPOOLED`); application runtime traffic uses the **pooled** one (`DATABASE_URL`).
- `packages/shared` ships compiled JS + `.d.ts` (a `build` step), never consumed as raw `.ts` from `node_modules` — avoids a runtime "cannot execute TypeScript" failure in Nest's compiled `dist/`.
- Auth is basic email+password only (no OAuth/social login, no passport dependency — the JWT guard is hand-rolled on `@nestjs/jwt` directly, which keeps it unit-testable without mocking Passport internals).
- `.env`, `.env.local`, `.neon`, and `node_modules` are git-ignored; never commit secrets.
- Every scaffolding CLI (`nest new`, `create-next-app`) is invoked with `--help` checked first in the step, since exact flags can shift between versions — the step's command is the intended one, but confirm before running if the installed version's help output disagrees.

---

## File Structure

```
d:\ComplyDesk\
├── .gitignore
├── package.json                 # npm workspaces root
├── tsconfig.base.json
├── README.md
├── .neon                        # written by `neon link` (git-ignored, already present)
├── seeds/
│   └── controls.json            # existing — consumed by the Prisma seed script
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── roles.ts
│           └── auth.ts
├── apps/
│   ├── api/                     # NestJS
│   │   ├── package.json
│   │   ├── .env                 # git-ignored; DATABASE_URL, DATABASE_URL_UNPOOLED
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── app.controller.ts
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.module.ts
│   │   │   │   ├── prisma.service.ts
│   │   │   │   └── prisma.service.spec.ts
│   │   │   ├── common/
│   │   │   │   ├── cls-keys.ts
│   │   │   │   ├── subdomain.ts
│   │   │   │   ├── subdomain.spec.ts
│   │   │   │   ├── tenant.middleware.ts
│   │   │   │   └── tenant.middleware.spec.ts
│   │   │   └── auth/
│   │   │       ├── auth.module.ts
│   │   │       ├── auth.controller.ts
│   │   │       ├── auth.service.ts
│   │   │       ├── auth.service.spec.ts
│   │   │       ├── jwt-auth.guard.ts
│   │   │       ├── jwt-auth.guard.spec.ts
│   │   │       └── dto/
│   │   │           ├── signup.dto.ts
│   │   │           └── login.dto.ts
│   │   └── test/
│   │       └── auth.e2e-spec.ts
│   └── web/                     # Next.js
│       ├── package.json
│       ├── next.config.ts
│       ├── .env.local           # git-ignored; NEXT_PUBLIC_API_URL
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── globals.css
│           │   ├── (auth)/
│           │   │   ├── login/page.tsx
│           │   │   └── signup/page.tsx
│           │   └── (dashboard)/
│           │       ├── layout.tsx
│           │       └── dashboard/page.tsx
│           ├── components/
│           │   ├── Sidebar.tsx
│           │   └── Sidebar.test.tsx
│           └── lib/
│               └── api.ts
```

---

### Task 1: Root workspace scaffold + git

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `README.md`

**Interfaces:**
- Produces: npm workspaces `apps/*`, `packages/*`, so every later task's `npm install` (run from repo root) links the internal packages.

- [ ] **Step 1: Initialize git**

```bash
cd d:/ComplyDesk
git init
git add -A
git commit -m "chore: initial state (skills, seeds)"
```

- [ ] **Step 2: Write root `.gitignore`**

```
node_modules/
dist/
.next/
.env
.env.local
.env.*.local
.neon
*.log
```

- [ ] **Step 3: Write root `package.json`**

```json
{
  "name": "complydesk",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"npm run dev -w apps/api\" \"npm run dev -w apps/web\"",
    "build": "npm run build -w packages/shared && npm run build -w apps/api && npm run build -w apps/web",
    "test": "npm run test -w apps/api"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true
  }
}
```

- [ ] **Step 5: Write `README.md` stub**

```markdown
# ComplyDesk

npm workspaces monorepo: `apps/web` (Next.js), `apps/api` (NestJS + Prisma), `packages/shared` (shared types).

## Setup

    npm install
    npm run build -w packages/shared
    npm run dev

See `apps/api/README-neon.md` (added in a later task) for Neon-specific env var and migration instructions.
```

- [ ] **Step 6: Install and verify**

```bash
npm install
npm pkg get workspaces
```

Expected: `npm install` completes with no errors (no workspace packages exist yet, so this just installs `concurrently`); `npm pkg get workspaces` prints `["apps/*","packages/*"]`.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .gitignore README.md package-lock.json
git commit -m "chore: scaffold npm workspaces root"
```

---

### Task 2: Confirm Neon link

The workspace is **already linked** (done during planning): `.neon` at the repo root pins org `org-royal-boat-08830339`, project `restless-water-11477407`, branch `production`. This task just verifies that state before later tasks depend on it — do not re-run `neon link` unless `.neon` is missing.

**Files:**
- Verify only: `.neon` (already present, git-ignored)

- [ ] **Step 1: Verify the CLI is authenticated and linked**

```bash
neon profile list -o json
cat .neon
```

Expected: the active profile shows a real `account` (not `-`); `.neon` contains `orgId: org-royal-boat-08830339`, `projectId: restless-water-11477407`, `branch: production`.

If `.neon` is missing or the profile is unauthenticated, stop and ask the user to run `neon auth` (or supply `NEON_API_KEY`) rather than guessing — do not create a new project.

- [ ] **Step 2: Confirm the project's database**

```bash
neon databases list -o json
```

Expected: one database named `neondb`, owner `neondb_owner`. No commit needed (nothing changed).

---

### Task 3: `packages/shared` — shared types, built to JS

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/roles.ts`, `packages/shared/src/auth.ts`

**Interfaces:**
- Produces: `Role` type (`'OWNER' | 'ADMIN' | 'MEMBER'`), `SignupInput`, `LoginInput`, `AuthResponse` interfaces — consumed by Task 9 (API DTOs implement `SignupInput`/`LoginInput`) and Task 10 (web forms/`lib/api.ts` use the same shapes).

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@complydesk/shared",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/shared/src/roles.ts`**

```typescript
export type Role = "OWNER" | "ADMIN" | "MEMBER";
```

- [ ] **Step 4: Write `packages/shared/src/auth.ts`**

```typescript
export interface SignupInput {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
}
```

- [ ] **Step 5: Write `packages/shared/src/index.ts`**

```typescript
export * from "./roles";
export * from "./auth";
```

- [ ] **Step 6: Install and build**

```bash
npm install
npm run build -w packages/shared
```

Expected: `packages/shared/dist/index.js` and `packages/shared/dist/index.d.ts` exist after the build (verify with `ls packages/shared/dist`). This build step must be re-run any time `packages/shared/src` changes — note this in the root README (append a line: "After editing packages/shared, run `npm run build -w packages/shared` before restarting apps/api or apps/web.").

- [ ] **Step 7: Commit**

```bash
git add packages/shared README.md
git commit -m "feat: add @complydesk/shared package"
```

---

### Task 4: `apps/api` — NestJS scaffold

**Files:**
- Create (via `nest new`, then edited): `apps/api/package.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/app.controller.ts`
- Delete: `apps/api/src/app.service.ts`, `apps/api/src/app.controller.spec.ts` (generated defaults referencing `AppService`, which this app doesn't use)

**Interfaces:**
- Produces: `GET /` health endpoint; `AppModule` as the composition root later tasks add imports/middleware to.

- [ ] **Step 1: Check the scaffolding CLI's flags**

```bash
npx @nestjs/cli new --help
```

Confirm flags for skipping git, picking npm, and non-interactive mode match the command below (adjust if the installed version differs — e.g. `-g`/`--skip-git`, `-p`/`--package-manager`).

- [ ] **Step 2: Scaffold the app**

```bash
cd d:/ComplyDesk
npx @nestjs/cli new apps/api --skip-git --package-manager npm --language TypeScript
```

- [ ] **Step 3: Rename the package and remove unused generated files**

Edit `apps/api/package.json`: change `"name"` to `"@complydesk/api"`. Then:

```bash
rm apps/api/src/app.service.ts apps/api/src/app.service.spec.ts apps/api/src/app.controller.spec.ts
```

- [ ] **Step 4: Overwrite `apps/api/src/app.controller.ts`**

```typescript
import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  health() {
    return { status: "ok", service: "complydesk-api" };
  }
}
```

- [ ] **Step 5: Overwrite `apps/api/src/app.module.ts`**

```typescript
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";

@Module({
  imports: [],
  controllers: [AppController],
})
export class AppModule {}
```

(Later tasks add `imports`/`configure()` here — this is the minimal starting point.)

- [ ] **Step 6: Add `@complydesk/shared` as a dependency**

```bash
npm install @complydesk/shared@* -w apps/api
```

- [ ] **Step 7: Run and verify**

```bash
npm run start -w apps/api &
sleep 3
curl -s http://localhost:3000/
kill %1
```

Expected: `{"status":"ok","service":"complydesk-api"}`. (Port is Nest's default 3000 for now — Task 7 moves it to 3001 once `apps/web` claims 3000.)

- [ ] **Step 8: Commit**

```bash
git add apps/api package.json
git commit -m "feat: scaffold apps/api (NestJS)"
```

---

### Task 5: Prisma — schema, migration, seed

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (add `prisma.seed` config, dependencies)

**Interfaces:**
- Produces: Prisma models `Tenant`, `User`, `Membership`, `Control`, `Evidence`, `Task`, and enums `Role`, `EvidenceStatus`, `TaskStatus` — consumed by every service task from here on (`PrismaService`, `AuthService`, `TenantMiddleware`, `JwtAuthGuard`).

- [ ] **Step 1: Install Prisma and pull env vars**

```bash
npm install prisma @prisma/client -w apps/api
npm install -D ts-node -w apps/api
cd d:/ComplyDesk
neon env pull --file apps/api/.env
```

Expected: `apps/api/.env` now contains `DATABASE_URL` (pooled, `-pooler` host) and `DATABASE_URL_UNPOOLED` (direct host). Read the file after to confirm both are present before continuing.

- [ ] **Step 2: Write `apps/api/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_URL_UNPOOLED")
}

enum Role {
  OWNER
  ADMIN
  MEMBER
}

enum EvidenceStatus {
  PENDING
  APPROVED
  REJECTED
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
}

model Tenant {
  id          String       @id @default(uuid())
  name        String
  slug        String       @unique
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  memberships Membership[]
  controls    Control[]
  evidence    Evidence[]
  tasks       Task[]
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  name         String
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  memberships  Membership[]
  evidence     Evidence[]   @relation("EvidenceUploadedBy")
  tasks        Task[]       @relation("TaskAssignee")
}

model Membership {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String
  role      Role
  createdAt DateTime @default(now())
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([tenantId, userId])
}

model Control {
  id                  String     @id @default(uuid())
  tenantId            String
  code                String
  category            String
  title               String
  description         String
  evidenceGuidance    String
  refreshIntervalDays Int
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  tenant              Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  evidence            Evidence[]
  tasks               Task[]

  @@unique([tenantId, code])
}

model Evidence {
  id           String         @id @default(uuid())
  tenantId     String
  controlId    String
  uploadedById String
  notes        String?
  fileUrl      String?
  status       EvidenceStatus @default(PENDING)
  collectedAt  DateTime       @default(now())
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  tenant       Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  control      Control        @relation(fields: [controlId], references: [id], onDelete: Cascade)
  uploadedBy   User           @relation("EvidenceUploadedBy", fields: [uploadedById], references: [id])
}

model Task {
  id          String     @id @default(uuid())
  tenantId    String
  controlId   String?
  assigneeId  String?
  title       String
  description String?
  status      TaskStatus @default(TODO)
  dueDate     DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  tenant      Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  control     Control?   @relation(fields: [controlId], references: [id], onDelete: SetNull)
  assignee    User?      @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
}
```

- [ ] **Step 3: Run the initial migration**

```bash
cd d:/ComplyDesk/apps/api
npx prisma migrate dev --name init
```

Expected: Prisma reports the migration applied against the direct (unpooled) URL and generates the client. Verify: `npx prisma migrate status` reports "Database schema is up to date!".

- [ ] **Step 4: Write `apps/api/prisma/seed.ts`**

```typescript
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

interface ControlSeed {
  code: string;
  category: string;
  title: string;
  description: string;
  evidence_guidance: string;
  refresh_interval_days: number;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Org", slug: "demo" },
  });

  const seedPath = join(__dirname, "..", "..", "..", "seeds", "controls.json");
  const controls: ControlSeed[] = JSON.parse(readFileSync(seedPath, "utf-8"));

  for (const c of controls) {
    await prisma.control.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: {
        category: c.category,
        title: c.title,
        description: c.description,
        evidenceGuidance: c.evidence_guidance,
        refreshIntervalDays: c.refresh_interval_days,
      },
      create: {
        tenantId: tenant.id,
        code: c.code,
        category: c.category,
        title: c.title,
        description: c.description,
        evidenceGuidance: c.evidence_guidance,
        refreshIntervalDays: c.refresh_interval_days,
      },
    });
  }

  console.log(`Seeded ${controls.length} controls for tenant "${tenant.slug}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 5: Register the seed script and run it**

Add to `apps/api/package.json`:

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

```bash
npx prisma db seed
```

Expected: `Seeded 18 controls for tenant "demo"`.

- [ ] **Step 6: Verify the seed landed**

```bash
npx prisma studio --browser none &
sleep 2
kill %1
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.control.count().then(n => { console.log('control count:', n); return p.\$disconnect(); });
"
```

Expected: `control count: 18`.

- [ ] **Step 7: Commit**

```bash
cd d:/ComplyDesk
git add apps/api/prisma apps/api/package.json apps/api/package-lock.json
git commit -m "feat: add Prisma schema, migration, and control seed"
```

(`apps/api/.env` stays untracked per `.gitignore`.)

---

### Task 6: `PrismaService` / `PrismaModule`

**Files:**
- Create: `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`, `apps/api/src/prisma/prisma.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `PrismaModule`)

**Interfaces:**
- Produces: `PrismaService` (extends `PrismaClient`, connects on module init) — injected by every later service (`TenantMiddleware`, `AuthService`, `JwtAuthGuard`).

- [ ] **Step 1: Write the failing test**

`apps/api/src/prisma/prisma.service.spec.ts`:

```typescript
import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  it("calls $connect on module init and $disconnect on module destroy", async () => {
    const service = new PrismaService();
    const connectSpy = jest.spyOn(service, "$connect").mockResolvedValue(undefined);
    const disconnectSpy = jest.spyOn(service, "$disconnect").mockResolvedValue(undefined);

    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd d:/ComplyDesk/apps/api
npx jest prisma/prisma.service.spec.ts
```

Expected: FAIL — `Cannot find module './prisma.service'`.

- [ ] **Step 3: Write `apps/api/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Write `apps/api/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Wire it into `AppModule`**

`apps/api/src/app.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx jest prisma/prisma.service.spec.ts
```

Expected: PASS (2 assertions).

- [ ] **Step 7: Commit**

```bash
cd d:/ComplyDesk
git add apps/api/src/prisma apps/api/src/app.module.ts
git commit -m "feat: add PrismaService/PrismaModule"
```

---

### Task 7: Subdomain parsing (TDD) + `TenantMiddleware` + `nestjs-cls`

**Files:**
- Create: `apps/api/src/common/cls-keys.ts`, `apps/api/src/common/subdomain.ts`, `apps/api/src/common/subdomain.spec.ts`, `apps/api/src/common/tenant.middleware.ts`, `apps/api/src/common/tenant.middleware.spec.ts`
- Modify: `apps/api/src/app.module.ts` (add `ClsModule.forRoot`, `configure()` applying `TenantMiddleware`)

**Interfaces:**
- Consumes: `PrismaService` (Task 6).
- Produces: `parseSubdomain(host): string | null`; `AppClsStore` type (`{ tenantId?: string; userId?: string; role?: Role }`); `TenantMiddleware` — sets `cls.tenantId`. Consumed by Task 8's `JwtAuthGuard` and `AuthController`.

- [ ] **Step 1: Install `nestjs-cls`**

```bash
npm install nestjs-cls -w apps/api
```

- [ ] **Step 2: Write the failing subdomain-parser test**

`apps/api/src/common/subdomain.spec.ts`:

```typescript
import { parseSubdomain } from "./subdomain";

describe("parseSubdomain", () => {
  it("extracts the subdomain from a *.localhost dev host", () => {
    expect(parseSubdomain("acme.localhost:3000")).toBe("acme");
  });

  it("returns null for bare localhost", () => {
    expect(parseSubdomain("localhost:3000")).toBeNull();
  });

  it("extracts the subdomain from a production host", () => {
    expect(parseSubdomain("acme.complydesk.com")).toBe("acme");
  });

  it("returns null for the bare root domain", () => {
    expect(parseSubdomain("complydesk.com")).toBeNull();
  });

  it("returns null for reserved subdomains", () => {
    expect(parseSubdomain("www.complydesk.com")).toBeNull();
    expect(parseSubdomain("app.complydesk.com")).toBeNull();
  });

  it("returns null when no host header is present", () => {
    expect(parseSubdomain(undefined)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd d:/ComplyDesk/apps/api
npx jest common/subdomain.spec.ts
```

Expected: FAIL — `Cannot find module './subdomain'`.

- [ ] **Step 4: Write `apps/api/src/common/subdomain.ts`**

```typescript
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api"]);

export function parseSubdomain(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return null;

  const parts = hostname.split(".");
  if (parts[parts.length - 1] === "localhost") {
    return parts.length >= 2 ? parts[0] : null;
  }
  if (parts.length <= 2) return null;

  const subdomain = parts[0];
  return RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest common/subdomain.spec.ts
```

Expected: PASS (6 assertions).

- [ ] **Step 6: Write `apps/api/src/common/cls-keys.ts`**

```typescript
import { ClsStore } from "nestjs-cls";
import { Role } from "@prisma/client";

export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  role?: Role;
}
```

- [ ] **Step 7: Write the failing middleware test**

`apps/api/src/common/tenant.middleware.spec.ts`:

```typescript
import { TenantMiddleware } from "./tenant.middleware";

describe("TenantMiddleware", () => {
  const buildDeps = () => ({
    prisma: { tenant: { findUnique: jest.fn() } } as any,
    cls: { set: jest.fn() } as any,
  });

  it("resolves the tenant from the host subdomain and stores its id in cls", async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue({ id: "tenant-1", slug: "acme" });
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use({ headers: { host: "acme.localhost:3000" } } as any, {} as any, next);

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: "acme" } });
    expect(cls.set).toHaveBeenCalledWith("tenantId", "tenant-1");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next without setting a tenant when the host has no subdomain", async () => {
    const { prisma, cls } = buildDeps();
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use({ headers: { host: "localhost:3000" } } as any, {} as any, next);

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(cls.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next without setting a tenant when the subdomain matches no tenant", async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue(null);
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use({ headers: { host: "ghost.localhost:3000" } } as any, {} as any, next);

    expect(cls.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

```bash
npx jest common/tenant.middleware.spec.ts
```

Expected: FAIL — `Cannot find module './tenant.middleware'`.

- [ ] **Step 9: Write `apps/api/src/common/tenant.middleware.ts`**

```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { ClsService } from "nestjs-cls";
import { PrismaService } from "../prisma/prisma.service";
import { AppClsStore } from "./cls-keys";
import { parseSubdomain } from "./subdomain";

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const subdomain = parseSubdomain(req.headers.host);
    if (subdomain) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug: subdomain } });
      if (tenant) {
        this.cls.set("tenantId", tenant.id);
      }
    }
    next();
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

```bash
npx jest common/tenant.middleware.spec.ts
```

Expected: PASS (3 assertions).

- [ ] **Step 11: Wire `ClsModule` and `TenantMiddleware` into `AppModule`**

`apps/api/src/app.module.ts`:

```typescript
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { TenantMiddleware } from "./common/tenant.middleware";

@Module({
  imports: [ClsModule.forRoot({ middleware: { mount: true } }), PrismaModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes("*");
  }
}
```

- [ ] **Step 12: Run the full test suite**

```bash
npx jest
```

Expected: all suites pass.

- [ ] **Step 13: Commit**

```bash
cd d:/ComplyDesk
git add apps/api/src apps/api/package.json apps/api/package-lock.json
git commit -m "feat: resolve tenant from subdomain into request-scoped cls"
```

---

### Task 8: Auth — signup, login, JWT guard, `/auth/me`

**Files:**
- Create: `apps/api/src/auth/dto/signup.dto.ts`, `apps/api/src/auth/dto/login.dto.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.service.spec.ts`, `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/auth/jwt-auth.guard.spec.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/test/auth.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `AuthModule`), `apps/api/src/main.ts` (CORS, `ValidationPipe`, port)

**Interfaces:**
- Consumes: `PrismaService` (Task 6), `AppClsStore`/`ClsService` (Task 7), `SignupInput`/`LoginInput`/`AuthResponse` from `@complydesk/shared` (Task 3).
- Produces: `POST /auth/signup`, `POST /auth/login` → `{ accessToken: string }`; `GET /auth/me` (guarded) → `{ tenantId, userId, role }`. Consumed by Task 10's `lib/api.ts`.

- [ ] **Step 1: Install dependencies**

```bash
npm install @nestjs/jwt bcrypt class-validator class-transformer -w apps/api
npm install -D @types/bcrypt supertest @types/supertest -w apps/api
```

- [ ] **Step 2: Write DTOs**

`apps/api/src/auth/dto/signup.dto.ts`:

```typescript
import { IsEmail, IsString, Matches, MinLength } from "class-validator";
import type { SignupInput } from "@complydesk/shared";

export class SignupDto implements SignupInput {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  tenantName: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "tenantSlug must be lowercase letters, numbers, and hyphens only",
  })
  tenantSlug: string;
}
```

`apps/api/src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsString } from "class-validator";
import type { LoginInput } from "@complydesk/shared";

export class LoginDto implements LoginInput {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 3: Write the failing `AuthService` test**

`apps/api/src/auth/auth.service.spec.ts`:

```typescript
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const buildService = () => {
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      tenant: { findUnique: jest.fn(), create: jest.fn() },
      membership: { create: jest.fn() },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    } as any;
    const jwt = { sign: jest.fn().mockReturnValue("signed-token") } as unknown as JwtService;
    return { service: new AuthService(prisma, jwt), prisma, jwt };
  };

  describe("signup", () => {
    it("creates a tenant, user, and OWNER membership, then returns a token", async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: "tenant-1", slug: "acme" });
      prisma.user.create.mockResolvedValue({ id: "user-1", email: "a@acme.com" });

      const result = await service.signup({
        email: "a@acme.com",
        password: "password123",
        name: "Ada",
        tenantName: "Acme Inc",
        tenantSlug: "acme",
      } as any);

      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { tenantId: "tenant-1", userId: "user-1", role: "OWNER" },
      });
      expect(result).toEqual({ accessToken: "signed-token" });
    });

    it("rejects signup when the email is already registered", async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.signup({ email: "a@acme.com", tenantSlug: "acme" } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("login", () => {
    it("returns a token when the password matches", async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash("password123", 10);
      prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@acme.com", passwordHash });

      const result = await service.login({ email: "a@acme.com", password: "password123" } as any);

      expect(result).toEqual({ accessToken: "signed-token" });
    });

    it("rejects login when the password does not match", async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash("password123", 10);
      prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@acme.com", passwordHash });

      await expect(
        service.login({ email: "a@acme.com", password: "wrong" } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("rejects login when the user does not exist", async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: "nobody@acme.com", password: "x" } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd d:/ComplyDesk/apps/api
npx jest auth/auth.service.spec.ts
```

Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 5: Write `apps/api/src/auth/auth.service.ts`**

```typescript
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto): Promise<{ accessToken: string }> {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException("An account with this email already exists");
    }
    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (existingTenant) {
      throw new ConflictException("This workspace URL is already taken");
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName, slug: dto.tenantSlug },
      });
      const createdUser = await tx.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: createdUser.id, role: "OWNER" },
      });
      return createdUser;
    });

    return { accessToken: this.jwt.sign({ sub: user.id }) };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return { accessToken: this.jwt.sign({ sub: user.id }) };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx jest auth/auth.service.spec.ts
```

Expected: PASS (5 assertions).

- [ ] **Step 7: Write the failing `JwtAuthGuard` test**

`apps/api/src/auth/jwt-auth.guard.spec.ts`:

```typescript
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  const buildGuard = () => {
    const jwt = { verifyAsync: jest.fn() } as any;
    const prisma = { membership: { findUnique: jest.fn() } } as any;
    const store = new Map<string, unknown>();
    const cls = {
      get: jest.fn((key: string) => store.get(key)),
      set: jest.fn((key: string, value: unknown) => store.set(key, value)),
    } as any;
    return { guard: new JwtAuthGuard(jwt, prisma, cls), jwt, prisma, cls };
  };

  const contextWith = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it("rejects requests without a bearer token", async () => {
    const { guard } = buildGuard();
    await expect(guard.canActivate(contextWith({}))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an invalid token", async () => {
    const { guard, jwt } = buildGuard();
    jwt.verifyAsync.mockRejectedValue(new Error("bad token"));
    await expect(
      guard.canActivate(contextWith({ authorization: "Bearer bad" })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when no tenant was resolved on the request", async () => {
    const { guard, jwt } = buildGuard();
    jwt.verifyAsync.mockResolvedValue({ sub: "user-1" });
    await expect(
      guard.canActivate(contextWith({ authorization: "Bearer good" })),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects when the user has no membership in the resolved tenant", async () => {
    const { guard, jwt, prisma, cls } = buildGuard();
    cls.set("tenantId", "tenant-1");
    jwt.verifyAsync.mockResolvedValue({ sub: "user-1" });
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextWith({ authorization: "Bearer good" })),
    ).rejects.toThrow(ForbiddenException);
  });

  it("stores userId and role in cls and allows the request through", async () => {
    const { guard, jwt, prisma, cls } = buildGuard();
    cls.set("tenantId", "tenant-1");
    jwt.verifyAsync.mockResolvedValue({ sub: "user-1" });
    prisma.membership.findUnique.mockResolvedValue({ role: "OWNER" });

    const result = await guard.canActivate(contextWith({ authorization: "Bearer good" }));

    expect(result).toBe(true);
    expect(cls.set).toHaveBeenCalledWith("userId", "user-1");
    expect(cls.set).toHaveBeenCalledWith("role", "OWNER");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

```bash
npx jest auth/jwt-auth.guard.spec.ts
```

Expected: FAIL — `Cannot find module './jwt-auth.guard'`.

- [ ] **Step 9: Write `apps/api/src/auth/jwt-auth.guard.ts`**

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { PrismaService } from "../prisma/prisma.service";
import { AppClsStore } from "../common/cls-keys";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const tenantId = this.cls.get("tenantId");
    if (!tenantId) {
      throw new ForbiddenException("Unknown or missing tenant");
    }

    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: payload.sub } },
    });
    if (!membership) {
      throw new ForbiddenException("No access to this workspace");
    }

    this.cls.set("userId", payload.sub);
    this.cls.set("role", membership.role);
    req.user = { id: payload.sub, role: membership.role };
    return true;
  }

  private extractToken(header: string | undefined): string | null {
    if (!header) return null;
    const [type, token] = header.split(" ");
    return type === "Bearer" && token ? token : null;
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

```bash
npx jest auth/jwt-auth.guard.spec.ts
```

Expected: PASS (5 assertions).

- [ ] **Step 11: Write `apps/api/src/auth/auth.controller.ts`**

```typescript
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { AppClsStore } from "../common/cls-keys";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post("signup")
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me() {
    return {
      tenantId: this.cls.get("tenantId"),
      userId: this.cls.get("userId"),
      role: this.cls.get("role"),
    };
  }
}
```

- [ ] **Step 12: Write `apps/api/src/auth/auth.module.ts`**

```typescript
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
      signOptions: { expiresIn: "7d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 13: Wire `AuthModule` into `AppModule`**

`apps/api/src/app.module.ts` — add `AuthModule` to `imports`:

```typescript
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { TenantMiddleware } from "./common/tenant.middleware";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [ClsModule.forRoot({ middleware: { mount: true } }), PrismaModule, AuthModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes("*");
  }
}
```

- [ ] **Step 14: Update `apps/api/src/main.ts`** (CORS, validation, port)

```typescript
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`ComplyDesk API listening on http://localhost:${port}`);
}
bootstrap();
```

Append to `apps/api/.env`: `API_PORT=3001`.

- [ ] **Step 15: Write the e2e test**

`apps/api/test/auth.e2e-spec.ts`:

```typescript
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("signs up, logs in, and returns tenant context on /auth/me", async () => {
    const server = app.getHttpServer();

    const signupRes = await request(server)
      .post("/auth/signup")
      .set("Host", `${slug}.localhost`)
      .send({
        email,
        password: "password123",
        name: "Ada Lovelace",
        tenantName: "E2E Tenant",
        tenantSlug: slug,
      })
      .expect(201);

    expect(signupRes.body.accessToken).toEqual(expect.any(String));

    const meRes = await request(server)
      .get("/auth/me")
      .set("Host", `${slug}.localhost`)
      .set("Authorization", `Bearer ${signupRes.body.accessToken}`)
      .expect(200);

    expect(meRes.body.tenantId).toEqual(expect.any(String));
    expect(meRes.body.userId).toEqual(expect.any(String));
    expect(meRes.body.role).toBe("OWNER");

    const loginRes = await request(server)
      .post("/auth/login")
      .set("Host", `${slug}.localhost`)
      .send({ email, password: "password123" })
      .expect(201);

    expect(loginRes.body.accessToken).toEqual(expect.any(String));
  });
});
```

This test runs against the real linked `production` branch (the project has only one branch). It uses a randomized slug/email and cleans up in `afterAll` to avoid polluting seed data. For CI, the recommended upgrade is a Neon test branch per run (see the `neon-postgres-branches` skill) — out of scope here.

- [ ] **Step 16: Run the e2e test**

```bash
cd d:/ComplyDesk/apps/api
npx jest --config ./test/jest-e2e.json
```

Expected: PASS (4 assertions). If `test/jest-e2e.json` doesn't already point at `test/*.e2e-spec.ts` (check the file `nest new` generated), adjust its `testRegex` rather than renaming the test file.

- [ ] **Step 17: Run the full unit + e2e suite**

```bash
npx jest && npx jest --config ./test/jest-e2e.json
```

Expected: everything passes.

- [ ] **Step 18: Commit**

```bash
cd d:/ComplyDesk
git add apps/api
git commit -m "feat: email/password auth with JWT + tenant-scoped /auth/me"
```

---

### Task 9: `apps/web` — Next.js scaffold

**Files:**
- Create (via `create-next-app`, then edited/added): `apps/web/package.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/api.ts`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/Sidebar.test.tsx`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/(dashboard)/layout.tsx`, `apps/web/src/app/(dashboard)/dashboard/page.tsx`
- Modify: `apps/web/.env.local` (created, not from `create-next-app`)

**Interfaces:**
- Consumes: `SignupInput`, `LoginInput`, `AuthResponse` from `@complydesk/shared` (Task 3); calls `apps/api`'s `POST /auth/signup`, `POST /auth/login` (Task 8).

- [ ] **Step 1: Check the scaffolding CLI's flags**

```bash
npx create-next-app@latest --help
```

Confirm flags for TypeScript, App Router, `src/` dir, import alias, no Tailwind, and non-interactive mode match the command below.

- [ ] **Step 2: Scaffold the app**

```bash
cd d:/ComplyDesk
npx create-next-app@latest apps/web --typescript --eslint --app --src-dir --import-alias "@/*" --no-tailwind --use-npm --yes
```

- [ ] **Step 3: Rename the package and add dependencies**

Edit `apps/web/package.json`: change `"name"` to `"@complydesk/web"`; change the `"dev"` script to `"next dev -p 3000"` (explicit, matches the port `apps/api`'s CORS config expects).

```bash
npm install @complydesk/shared@* -w apps/web
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react -w apps/web
```

Add to `apps/web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 4: Write `apps/web/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 5: Write `apps/web/src/lib/api.ts`**

```typescript
import type { AuthResponse, LoginInput, SignupInput } from "@complydesk/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request to ${path} failed with ${res.status}`);
  }
  return res.json();
}

export function signup(input: SignupInput): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/signup", input);
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/login", input);
}
```

- [ ] **Step 6: Write the failing `Sidebar` test**

`apps/web/src/components/Sidebar.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders a link for each nav item", () => {
    render(<Sidebar />);
    for (const label of ["Dashboard", "Controls", "Evidence", "Tasks", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
```

Add a `apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"] },
});
```

`apps/web/vitest.setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Run it to verify it fails**

```bash
cd d:/ComplyDesk/apps/web
npx vitest run
```

Expected: FAIL — `Cannot find module './Sidebar'`.

- [ ] **Step 8: Write `apps/web/src/components/Sidebar.tsx`**

```typescript
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/controls", label: "Controls" },
  { href: "/evidence", label: "Evidence" },
  { href: "/tasks", label: "Tasks" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  return (
    <nav aria-label="Main">
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

```bash
npx vitest run
```

Expected: PASS (1 assertion covering all 5 links).

- [ ] **Step 10: Write `apps/web/src/app/(dashboard)/layout.tsx`**

```typescript
import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, borderRight: "1px solid #e2e2e2", padding: "1rem" }}>
        <Sidebar />
      </aside>
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 11: Write `apps/web/src/app/(dashboard)/dashboard/page.tsx`**

```typescript
export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome to ComplyDesk.</p>
    </div>
  );
}
```

- [ ] **Step 12: Write `apps/web/src/app/(auth)/login/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { accessToken } = await login({ email, password });
      localStorage.setItem("accessToken", accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  );
}
```

- [ ] **Step 13: Write `apps/web/src/app/(auth)/signup/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signup } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    tenantName: "",
    tenantSlug: "",
  });
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { accessToken } = await signup(form);
      localStorage.setItem("accessToken", accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign up</h1>
      <label>
        Name
        <input value={form.name} onChange={update("name")} required />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={update("email")} required />
      </label>
      <label>
        Password
        <input type="password" value={form.password} onChange={update("password")} required />
      </label>
      <label>
        Workspace name
        <input value={form.tenantName} onChange={update("tenantName")} required />
      </label>
      <label>
        Workspace URL
        <input value={form.tenantSlug} onChange={update("tenantSlug")} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign up</button>
    </form>
  );
}
```

- [ ] **Step 14: Verify the app builds and runs**

```bash
cd d:/ComplyDesk/apps/web
npm run build
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/signup
kill %1
```

Expected: `npm run build` succeeds; all three curls print `200`.

- [ ] **Step 15: Commit**

```bash
cd d:/ComplyDesk
git add apps/web package.json package-lock.json
git commit -m "feat: scaffold apps/web (Next.js) with sidebar layout and auth pages"
```

---

### Task 10: Root dev workflow + documentation

**Files:**
- Modify: `README.md`
- Create: `apps/api/README-neon.md`

**Interfaces:**
- Produces: `npm run dev` at the repo root running both apps together — the final integration point exercised by this task's verification step.

- [ ] **Step 1: Write `apps/api/README-neon.md`**

```markdown
# Neon setup for apps/api

This app is linked to Neon project **ComplyDesk** (`restless-water-11477407`) in org
**Mohamad** (`org-royal-boat-08830339`), branch `production`, database `neondb`.

- `.neon` at the repo root pins the org/project/branch (git-ignored, already present).
- `apps/api/.env` holds `DATABASE_URL` (pooled, used by the running app) and
  `DATABASE_URL_UNPOOLED` (direct, used by Prisma migrations). Regenerate with:

      neon env pull --file apps/api/.env

- Run migrations with `npx prisma migrate dev` (from `apps/api`) — Prisma reads
  `directUrl` automatically, no extra flags needed.
- Re-seed the control catalog with `npx prisma db seed` (from `apps/api`).
```

- [ ] **Step 2: Update root `README.md`** — replace the stub written in Task 1 with:

```markdown
# ComplyDesk

npm workspaces monorepo:

- `apps/web` — Next.js (App Router) frontend, port 3000.
- `apps/api` — NestJS + Prisma API, port 3001. Only this app talks to Postgres.
- `packages/shared` — shared TypeScript types (`Role`, auth DTOs), built to `dist/` —
  run `npm run build -w packages/shared` after editing it, before restarting the apps.

## Setup

    npm install
    npm run build -w packages/shared
    npm run dev          # runs apps/api and apps/web together

See [apps/api/README-neon.md](apps/api/README-neon.md) for Neon connection details.

## Multi-tenancy

Tenant is resolved from the request's `Host` subdomain (e.g. `acme.localhost:3000` →
tenant `acme`); user identity comes from a JWT bearer token. Both are combined into a
per-request context (`{ tenantId, userId, role }`) via `nestjs-cls`, readable anywhere
in `apps/api` with `ClsService<AppClsStore>` — see `apps/api/src/common/tenant.middleware.ts`
and `apps/api/src/auth/jwt-auth.guard.ts`.
```

- [ ] **Step 3: End-to-end smoke test — run both apps together**

```bash
cd d:/ComplyDesk
npm run dev &
sleep 5
curl -s http://localhost:3001/
curl -s -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -H "Host: smoketest.localhost" \
  -d '{"email":"smoke@test.com","password":"password123","name":"Smoke Test","tenantName":"Smoke Co","tenantSlug":"smoketest"}'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard
kill %1
```

Expected: health check returns `{"status":"ok",...}`; signup returns `{"accessToken":"..."}`; dashboard page returns `200`.

Clean up the smoke-test tenant afterward:

```bash
cd d:/ComplyDesk/apps/api
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.tenant.deleteMany({ where: { slug: 'smoketest' } })
  .then(() => p.user.deleteMany({ where: { email: 'smoke@test.com' } }))
  .then(() => p.\$disconnect());
"
```

- [ ] **Step 4: Commit**

```bash
cd d:/ComplyDesk
git add README.md apps/api/README-neon.md
git commit -m "docs: document dev workflow and Neon setup"
```

---

## Self-Review Notes

- **Spec coverage:** monorepo layout (Task 1, 3, 4, 9), Prisma on Postgres via a provided Neon connection (Task 2, 5), core schema — tenants/users/memberships/controls/evidence/tasks (Task 5), basic email/password auth (Task 8), subdomain tenant resolution + `nestjs-cls` `{tenantId,userId,role}` (Task 7, 8), Next.js sidebar layout + empty dashboard + signup/login pages (Task 9) — all covered.
- **Neon services in use:** only Postgres (Lakebase Postgres). No Auth/Object Storage/Functions/AI Gateway are wired, since the app uses hand-rolled JWT auth and no file storage or LLM calls — nothing in the request implies those services are needed.
- **No placeholders:** every step has real, runnable code or a concrete command; no "TBD"/"add validation later" left in.
