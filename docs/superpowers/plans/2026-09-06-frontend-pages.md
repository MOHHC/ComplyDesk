# Missing Frontend Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five frontend surfaces that currently have working backend endpoints but no (or only unstyled scaffold) UI — Controls, Evidence review, Tasks, Policy Documents, Gap Analysis — matching the existing ledger/tick-gutter design system.

**Architecture:** Pure client-side Next.js App Router pages (`'use client'`, matching every existing page in this app — there is no server-component data fetching anywhere in `apps/web`). Each page calls `apps/web/src/lib/api.ts`, which is extended with five new functions but otherwise unchanged in shape. Two new shared UI files carry design-system primitives; `packages/shared` gains typed contracts for the three DB shapes (`EvidenceClassification`, `PolicyDocument`, `GapAnalysisResult`) the frontend has never had types for. One narrow, explicitly-approved backend touch: `EvidenceService.listForControl()` gains a Prisma `include` so classification data survives a page refresh instead of only existing in the upload response's local state.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Tailwind v4 (`@theme` tokens in `globals.css`), TypeScript, npm workspaces. No test framework in `apps/web` — verification is `npm run build -w apps/web` (runs Next's type-checker) and `npm run lint -w apps/web`, plus manual dev-server checks (this is visual, user-facing work; a type-check passing is necessary but not sufficient).

**Spec:** This plan's spec is the user's request transcribed in Global Constraints below — there is no separate spec doc for this feature.

## Global Constraints

- Reuse the existing design system exactly: `--color-paper`/`--color-paper-raised`/`--color-ink`/`--color-ink-muted`/`--color-rule` for structure and text, `--color-verified`/`--color-expiring`/`--color-exception` as the *only* saturated colors and *only* for compliance-state meaning (never decorative). `font-mono` for records (codes, dates, counts, percentages — never prose). `tabular` class on any column of numerals that must align. No new colors, no new type scale, no card/shadow-based layout — structure is carried by hairline rules (`border-rule`) and left-gutter tone marks (`border-l-2 border-l-{tone}`), the pattern already established in `DashboardPage`'s `LedgerRow`.
- No new backend logic except the one approved exception: `EvidenceService.listForControl()` gains a Prisma `include` for `classification` (+ nested `suggestedControl`). No new endpoints, no new tables, no new business rules, no migration.
- Every page is a client component behind the existing `(dashboard)` layout's auth gate — follow `useAuth()` / `token` / `me.role` exactly as the existing three pages already do. Do not invent a second auth pattern.
- Role gating client-side is a UX nicety only, matching the codebase's own stated principle (see `controls/[id]/page.tsx`'s `CAN_UPLOAD`/`CAN_ASSIGN` comment) — the server enforces the real boundary regardless via `@Roles(...)`.
- `apps/web` has no test framework. Verification per task is `npm run build -w apps/web` (type-check + build) and `npm run lint -w apps/web`, plus an explicit manual check against the running dev server for that task's page. `apps/api`/`packages/shared` tasks use their own `npm run build -w <pkg>` / `npm test -w apps/api`.

---

## File Structure

New files:
- `packages/shared/src/ai.ts` — types for classification, policy documents, gap analysis
- `apps/web/src/components/register.tsx` — shared register/table primitives (header row, tone-marked row shell, skeleton, empty state)
- `apps/web/src/app/(dashboard)/policy-documents/page.tsx` — new page
- `apps/web/src/app/(dashboard)/gap-analysis/page.tsx` — new page

Modified files:
- `apps/api/src/evidence/evidence.service.ts` — `listForControl()` gains one `include`
- `packages/shared/src/controls.ts` — `Evidence` gets a `classification` field
- `packages/shared/src/index.ts` — export the new `ai.ts` module
- `apps/web/src/lib/api.ts` — five new functions
- `apps/web/src/components/ui.tsx` — one new `Badge` primitive
- `apps/web/src/components/Sidebar.tsx` — two new nav items
- `apps/web/src/app/(dashboard)/controls/page.tsx` — visual rebuild, same data/filter logic
- `apps/web/src/app/(dashboard)/controls/[id]/page.tsx` — visual rebuild + classification review UI (new)
- `apps/web/src/app/(dashboard)/tasks/page.tsx` — visual rebuild, same logic

---

### Task 1: Shared types for classification, policy documents, gap analysis

**Files:**
- Create: `packages/shared/src/ai.ts`
- Modify: `packages/shared/src/controls.ts` (add `classification` to `Evidence`)
- Modify: `packages/shared/src/index.ts` (export `./ai`)
- Test: none (no test framework in this package) — verified by build

**Interfaces:**
- Produces: `ControlRef`, `ClassificationReviewStatus`, `ClassificationDecision`, `EvidenceClassification`, `PolicyDocStatus`, `PolicyDocument`, `PolicyChunkRef`, `GapAnalysisResult`, `GapAnalysisReport` — all exported from `@complydesk/shared`, consumed by every later task.

`ControlRef` is deliberately **not** the existing `Control` type: `Control.status`/`lastEvidenceAt` are computed by `ControlsService` at request time (see `apps/api/src/controls/controls.service.ts`), not raw DB columns — a control nested inside a classification or a gap-analysis result via a plain Prisma `include` never has them. Reusing `Control` here would type a field that will always be `undefined` at runtime.

- [ ] **Step 1: Create `packages/shared/src/ai.ts`**

```typescript
export type ClassificationReviewStatus = "PENDING" | "CONFIRMED" | "OVERRIDDEN" | "DISMISSED";
export type ClassificationDecision = "confirm" | "override" | "dismiss";

/**
 * A control as it appears nested inside another resource (a
 * classification's suggestion, a gap-analysis result) via a plain Prisma
 * `include`. Deliberately not the `Control` type from ./controls — that
 * type's `status`/`lastEvidenceAt` are computed by ControlsService at
 * request time, not raw columns, and are never present here.
 */
export interface ControlRef {
  id: string;
  code: string;
  category: string;
  title: string;
  description: string;
}

export interface EvidenceClassification {
  id: string;
  evidenceId: string;
  suggestedControlId: string | null;
  suggestedControl: ControlRef | null;
  confidence: number;
  reasoning: string;
  reviewStatus: ClassificationReviewStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type PolicyDocStatus = "PROCESSING" | "READY" | "FAILED";

export interface PolicyDocument {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  status: PolicyDocStatus;
  uploadedById: string;
  createdAt: string;
}

export interface PolicyChunkRef {
  id: string;
  chunkIndex: number;
  content: string;
  document: { id: string; fileName: string };
}

export interface GapAnalysisResult {
  id: string;
  runId: string;
  controlId: string;
  covered: boolean;
  reasoning: string;
  citationChunkId: string | null;
  control: ControlRef;
  citationChunk: PolicyChunkRef | null;
}

export interface GapAnalysisReport {
  runId: string;
  createdAt: string;
  results: GapAnalysisResult[];
}
```

- [ ] **Step 2: Add `classification` to `Evidence` in `packages/shared/src/controls.ts`**

Add this import at the top of the file:

```typescript
import type { EvidenceClassification } from "./ai";
```

Then change the `Evidence` interface (currently ends at `downloadUrl: string;`) to:

```typescript
export interface Evidence {
  id: string;
  controlId: string;
  uploadedById: string;
  notes: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  collectedAt: string;
  downloadUrl: string;
  classification: EvidenceClassification | null;
}
```

- [ ] **Step 3: Export the new module from `packages/shared/src/index.ts`**

```typescript
export * from "./roles";
export * from "./auth";
export * from "./subdomain";
export * from "./controls";
export * from "./ai";
```

- [ ] **Step 4: Build to verify**

Run: `npm run build -w packages/shared`
Expected: exits 0, `packages/shared/dist/ai.js` and `packages/shared/dist/ai.d.ts` exist.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai.ts packages/shared/src/controls.ts packages/shared/src/index.ts
git commit -m "feat(shared): add types for classification, policy documents, gap analysis"
```

---

### Task 2: Backend — include classification in the evidence list endpoint

**Files:**
- Modify: `apps/api/src/evidence/evidence.service.ts:94-112` (the `listForControl` method)
- Test: `apps/api/test/evidence-classification.e2e-spec.ts` (existing e2e spec — extend it; do not create a new file)

**Interfaces:**
- Consumes: nothing new — this is the one backend addition Task 1's `EvidenceClassification`/`ControlRef` types describe.
- Produces: `GET /controls/:controlId/evidence` now returns each row's `classification` object (with nested `suggestedControl`) instead of omitting it entirely, matching the shape `Evidence.classification` (Task 1) declares.

- [ ] **Step 1: Read the current method to confirm line numbers before editing**

`listForControl` in `apps/api/src/evidence/evidence.service.ts` currently reads:

```typescript
  async listForControl(controlId: string) {
    const tx = this.tx();
    const control = await tx.control.findUnique({ where: { id: controlId } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }

    const rows = await tx.evidence.findMany({
      where: { controlId },
      orderBy: { collectedAt: 'desc' },
    });

    return Promise.all(
      rows.map(async (row: (typeof rows)[number]) => ({
        ...row,
        downloadUrl: await this.storage.getDownloadUrl(row.fileKey),
      })),
    );
  }
```

- [ ] **Step 2: Write the failing e2e test**

Open `apps/api/test/evidence-classification.e2e-spec.ts`. Find the existing `describe('Evidence classification (e2e)', ...)` block (created for the earlier classification work) and add this test inside it, alongside the existing tests — it uses the same `FakeAiProvider`/fixture pattern every other test in that file already uses:

```typescript
  it('GET /controls/:id/evidence includes classification data, not just the upload response', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/controls/${fixture.controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('quarterly access review completed'), 'evidence.txt')
      .expect(201);
    expect(uploadRes.body.classification).toBeTruthy();

    // The point of this test: a *separate* GET, simulating a page
    // refresh, must carry the same classification data — not just the
    // one-shot upload response.
    const listRes = await request(app.getHttpServer())
      .get(`/controls/${fixture.controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    const row = listRes.body.find((e: { id: string }) => e.id === uploadRes.body.id);
    expect(row.classification).toBeTruthy();
    expect(row.classification.confidence).toBe(uploadRes.body.classification.confidence);
    expect(row.classification.reasoning).toBe(uploadRes.body.classification.reasoning);
    expect(row.classification.reviewStatus).toBe('PENDING');
  });
```

If the file's existing fixture setup uses different variable names than `fixture.controlId`/`fixture.slug`/`fixture.ownerToken`, match whatever the file's other tests actually use — read the file first and copy its established pattern exactly rather than guessing names.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:e2e -w apps/api -- evidence-classification`
Expected: FAIL — `row.classification` is `undefined` (the endpoint doesn't return it yet).

- [ ] **Step 4: Add the include**

Replace the `listForControl` method with:

```typescript
  async listForControl(controlId: string) {
    const tx = this.tx();
    const control = await tx.control.findUnique({ where: { id: controlId } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }

    const rows = await tx.evidence.findMany({
      where: { controlId },
      orderBy: { collectedAt: 'desc' },
      include: { classification: { include: { suggestedControl: true } } },
    });

    return Promise.all(
      rows.map(async (row: (typeof rows)[number]) => ({
        ...row,
        downloadUrl: await this.storage.getDownloadUrl(row.fileKey),
      })),
    );
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:e2e -w apps/api -- evidence-classification`
Expected: PASS — all tests in the file, including the new one.

- [ ] **Step 6: Run the full unit suite to confirm nothing else broke**

Run: `npm test -w apps/api`
Expected: PASS, same suite/test counts as before this change plus nothing removed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/evidence/evidence.service.ts apps/api/test/evidence-classification.e2e-spec.ts
git commit -m "fix(api): include classification data in the evidence list endpoint"
```

---

### Task 3: `api.ts` — client functions for classification review, policy documents, gap analysis

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Test: none (no test framework) — verified by build

**Interfaces:**
- Consumes: `ClassificationDecision`, `PolicyDocument`, `GapAnalysisReport` from `@complydesk/shared` (Task 1); the existing `request`/`requestMultipart` helpers already in this file.
- Produces: `reviewClassification(token, controlId, evidenceId, decision)`, `uploadPolicyDocument(token, file)`, `listPolicyDocuments(token)`, `runGapAnalysis(token)`, `getLatestGapAnalysis(token)` — every later page task calls these by these exact names.

- [ ] **Step 1: Add the import**

Change the top-of-file import block from:

```typescript
import type {
  AuthResponse,
  Control,
  ControlStatus,
  Evidence,
  LoginInput,
  MeResponse,
  Member,
  ReadinessSummary,
  SignupInput,
  SignupResponse,
  Task,
  TaskStatus,
  WorkspaceSummary,
} from '@complydesk/shared';
```

to:

```typescript
import type {
  AuthResponse,
  ClassificationDecision,
  Control,
  ControlStatus,
  Evidence,
  GapAnalysisReport,
  LoginInput,
  MeResponse,
  Member,
  PolicyDocument,
  ReadinessSummary,
  SignupInput,
  SignupResponse,
  Task,
  TaskStatus,
  WorkspaceSummary,
} from '@complydesk/shared';
```

- [ ] **Step 2: Add the five functions**

Append to the end of `apps/web/src/lib/api.ts`, after the existing `listMembers`:

```typescript
export function reviewClassification(
  token: string,
  controlId: string,
  evidenceId: string,
  decision: ClassificationDecision,
): Promise<Evidence['classification']> {
  return request(`/controls/${controlId}/evidence/${evidenceId}/classification`, {
    method: 'PATCH',
    body: { decision },
    token,
  });
}

export function uploadPolicyDocument(token: string, file: File): Promise<PolicyDocument> {
  const form = new FormData();
  form.set('file', file);
  return requestMultipart<PolicyDocument>('/policy-documents', form, token);
}

export function listPolicyDocuments(token: string): Promise<PolicyDocument[]> {
  return request<PolicyDocument[]>('/policy-documents', { token });
}

export function runGapAnalysis(token: string): Promise<GapAnalysisReport> {
  return request<GapAnalysisReport>('/gap-analysis/run', { method: 'POST', token });
}

export function getLatestGapAnalysis(token: string): Promise<GapAnalysisReport | null> {
  return request<GapAnalysisReport | null>('/gap-analysis/latest', { token });
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build -w apps/web`
Expected: exits 0. (This will only fully succeed once Task 1 is committed and `packages/shared` is rebuilt — if run standalone before Task 1's build, TypeScript will fail to resolve the new type imports. Run `npm run build -w packages/shared` first if that happens.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add API client functions for classification review, policy documents, gap analysis"
```

---

### Task 4: Shared UI primitives — `Badge` and register-view building blocks

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (add `Badge`)
- Create: `apps/web/src/components/register.tsx`
- Test: none — verified by build

**Interfaces:**
- Consumes: design tokens from `globals.css` (`--color-verified`/`--color-expiring`/`--color-exception`/`--color-ink-muted`/`--color-rule`) — no new tokens.
- Produces: `Badge({ tone, children })` from `ui.tsx`; `RegisterHeader({ columns })`, `RegisterEmpty({ children })`, `RegisterSkeletonRows({ count })` from `register.tsx` — every page task (5-9) uses these instead of inventing its own header/empty/skeleton markup.

- [ ] **Step 1: Add `Badge` to `apps/web/src/components/ui.tsx`**

Append after the existing `Notice` function (before `TextLink`):

```typescript
/** A compact status mark for a table/register cell — the mono, boxed
 * counterpart to Notice's prose-toned alerts. Tone follows the same
 * verified/expiring/exception triad as everywhere else; 'neutral' is
 * for states that carry no compliance meaning (e.g. a task's TODO
 * status), never used for anything status.css governs. */
export function Badge({
  tone,
  children,
}: {
  tone: 'verified' | 'expiring' | 'exception' | 'neutral';
  children: React.ReactNode;
}) {
  const styles: Record<typeof tone, string> = {
    verified: 'border-verified/35 bg-verified/10 text-verified',
    expiring: 'border-expiring/35 bg-expiring/10 text-expiring',
    exception: 'border-exception/35 bg-exception/10 text-exception',
    neutral: 'border-rule bg-paper-raised text-ink-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/register.tsx`**

```typescript
/**
 * Shared shell for the register-style list views (Controls, Tasks,
 * Policy Documents, Gap Analysis report). A "register" here is the
 * dashboard's own pattern generalized: a ruled header row of column
 * labels, then hairline-separated rows — never a card grid, never a
 * shadow. Row bodies stay page-specific (each list's columns differ too
 * much to force through one generic <Table>); only the header, empty,
 * and loading chrome are shared.
 */

export function RegisterHeader({ columns }: { columns: string[] }) {
  return (
    <div className="flex gap-4 border-b border-rule pb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
      {columns.map((col) => (
        <span key={col} className="flex-1 first:flex-[1.4]">
          {col}
        </span>
      ))}
    </div>
  );
}

export function RegisterEmpty({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-rule py-6 text-[13px] text-ink-muted">{children}</p>;
}

export function RegisterSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-l-2 border-rule border-l-transparent py-3.5 pr-1 pl-4"
        >
          <span className="h-4 flex-[1.4] rounded-sm bg-rule/50" />
          <span className="h-4 flex-1 rounded-sm bg-rule/35" />
          <span className="h-4 flex-1 rounded-sm bg-rule/35" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build -w apps/web`
Expected: exits 0 (both files are unused exports at this point — Next's build does not fail on unused exports, only unused local variables, so this is safe to verify in isolation).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/register.tsx
git commit -m "feat(web): add Badge and register-view shared primitives"
```

---

### Task 5: Controls list page — visual rebuild

**Files:**
- Modify: `apps/web/src/app/(dashboard)/controls/page.tsx` (full rewrite — same data logic, new markup)

**Interfaces:**
- Consumes: `listControls` (existing, unchanged), `Badge`/`RegisterHeader`/`RegisterEmpty`/`RegisterSkeletonRows` (Task 4).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Replace the file's contents**

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Control, ControlStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listControls } from '@/lib/api';
import { Badge } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

const STATUS_LABEL: Record<ControlStatus, string> = {
  no_evidence: 'No evidence',
  has_evidence: 'Evidence on file',
  evidence_expired: 'Evidence expired',
};

const STATUS_TONE: Record<ControlStatus, 'verified' | 'expiring' | 'exception'> = {
  no_evidence: 'exception',
  has_evidence: 'verified',
  evidence_expired: 'expiring',
};

function ControlRow({ control }: { control: Control }) {
  return (
    <Link
      href={`/controls/${control.id}`}
      className={`flex items-center gap-4 border-b border-l-2 border-rule py-3.5 pr-1 pl-4 transition-colors duration-150 hover:bg-paper-raised border-l-${STATUS_TONE[control.status]}`}
    >
      <span className="flex-[1.4] min-w-0">
        <span className="block font-mono text-[12px] text-ink-muted">{control.code}</span>
        <span className="block truncate text-[14px] font-medium text-ink">{control.title}</span>
      </span>
      <span className="flex-1 text-[13px] text-ink-muted">{control.category}</span>
      <span className="flex-1">
        <Badge tone={STATUS_TONE[control.status]}>{STATUS_LABEL[control.status]}</Badge>
      </span>
    </Link>
  );
}

export default function ControlsPage() {
  const { token, ready } = useAuth();
  const [controls, setControls] = useState<Control[]>([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ControlStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listControls(token, {
      category: category || undefined,
      status: status || undefined,
    })
      .then(setControls)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load controls'))
      .finally(() => setLoading(false));
  }, [token, category, status]);

  const categories = useMemo(
    () => Array.from(new Set(controls.map((c) => c.category))).sort(),
    [controls],
  );

  if (!ready) return null;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Controls</h1>
        <span className="font-mono text-[11px] text-ink-muted">
          {loading ? '—' : `${controls.length} shown`}
        </span>
      </header>

      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ControlStatus | '')}
          className="rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as ControlStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="mb-4 text-[13px] text-exception">{error}</p>}

      <RegisterHeader columns={['Control', 'Category', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={6} />
      ) : controls.length === 0 ? (
        <RegisterEmpty>No controls match this filter.</RegisterEmpty>
      ) : (
        controls.map((control) => <ControlRow key={control.id} control={control} />)
      )}
    </div>
  );
}
```

Note: Tailwind v4 cannot resolve a fully dynamic class string like `` `border-l-${STATUS_TONE[control.status]}` `` at build time (its scanner needs the literal class text present in source) — verify this in Step 2; if the border color doesn't render, replace the dynamic template with an explicit lookup map instead:

```typescript
const STATUS_GUTTER: Record<ControlStatus, string> = {
  no_evidence: 'border-l-exception',
  has_evidence: 'border-l-verified',
  evidence_expired: 'border-l-expiring',
};
```

and use `className={`... ${STATUS_GUTTER[control.status]}`}` in place of the template literal. (`DashboardPage`'s existing `TONE_RULE`/`TONE_TEXT` lookup maps are precedent for this exact pattern — follow them rather than the dynamic string.)

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Run: `npm run dev -w apps/web` (or the monorepo's `npm run dev` if the API isn't already running separately)
Then in a browser, sign in and visit `/controls`. Confirm: the left-gutter color actually renders per status (not just the label) — this directly tests the Tailwind dynamic-class concern from Step 1. Confirm category/status filters narrow the list. Confirm clicking a row navigates to `/controls/:id`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/controls/page.tsx
git commit -m "feat(web): rebuild the controls list page to match the design system"
```

---

### Task 6: Control detail page — visual rebuild + evidence classification review UI

**Files:**
- Modify: `apps/web/src/app/(dashboard)/controls/[id]/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getControl`, `listEvidence`, `uploadEvidence`, `listMembers`, `createTask` (existing, unchanged), `reviewClassification` (Task 3), `Badge`/`RegisterHeader`/`RegisterEmpty` (Task 4).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Replace the file's contents**

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ClassificationDecision, Control, Evidence, Member } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import {
  createTask,
  getControl,
  listEvidence,
  listMembers,
  reviewClassification,
  uploadEvidence,
} from '@/lib/api';
import { Badge, Button, Field, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader } from '@/components/register';

// Roles allowed to upload evidence — kept in sync with the API's own
// @Roles(OWNER, ADMIN, CONTRIBUTOR) on POST /controls/:id/evidence. The
// server enforces this regardless; hiding the form for AUDITOR is a UX
// nicety, not the actual boundary.
const CAN_UPLOAD = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR']);
const CAN_ASSIGN = new Set(['OWNER', 'ADMIN']);
const CAN_REVIEW_CLASSIFICATION = CAN_UPLOAD;

function ReviewStatusBadge({ status }: { status: NonNullable<Evidence['classification']>['reviewStatus'] }) {
  if (status === 'CONFIRMED') return <Badge tone="verified">Confirmed</Badge>;
  if (status === 'OVERRIDDEN') return <Badge tone="expiring">Moved</Badge>;
  if (status === 'DISMISSED') return <Badge tone="neutral">Dismissed</Badge>;
  return <Badge tone="expiring">Needs review</Badge>;
}

/** The AI classification suggestion attached to one evidence row, with
 * confirm/override/dismiss actions when it's still pending review. This
 * is the piece that didn't exist before this page's rebuild — the API
 * has carried this data on upload since the AI layer shipped, but no UI
 * ever surfaced it. */
function ClassificationPanel({
  controlId,
  evidence,
  canReview,
  onReviewed,
}: {
  controlId: string;
  evidence: Evidence;
  canReview: boolean;
  onReviewed: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<ClassificationDecision | null>(null);
  const classification = evidence.classification;
  if (!classification) {
    return <p className="mt-1.5 text-[12px] text-ink-muted">No AI classification for this file.</p>;
  }

  async function handleDecision(decision: ClassificationDecision) {
    if (!token) return;
    setBusy(decision);
    try {
      await reviewClassification(token, controlId, evidence.id, decision);
      onReviewed();
    } finally {
      setBusy(null);
    }
  }

  const pending = classification.reviewStatus === 'PENDING';

  return (
    <div className="mt-2 border-l-2 border-l-rule pl-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <ReviewStatusBadge status={classification.reviewStatus} />
        <span className="tabular font-mono text-ink-muted">
          {Math.round(classification.confidence * 100)}% confidence
        </span>
        {classification.suggestedControl && (
          <span className="text-ink-muted">
            suggests <span className="font-mono text-ink">{classification.suggestedControl.code}</span> —{' '}
            {classification.suggestedControl.title}
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{classification.reasoning}</p>

      {pending && canReview && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => handleDecision('confirm')}
            className="cursor-pointer text-[12px] font-medium text-verified underline decoration-verified/40 underline-offset-2 hover:decoration-verified disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'confirm' ? 'Confirming…' : 'Confirm'}
          </button>
          {classification.suggestedControl && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleDecision('override')}
              className="cursor-pointer text-[12px] font-medium text-expiring underline decoration-expiring/40 underline-offset-2 hover:decoration-expiring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'override' ? 'Moving…' : `Move to ${classification.suggestedControl.code}`}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => handleDecision('dismiss')}
            className="cursor-pointer text-[12px] font-medium text-ink-muted underline decoration-rule underline-offset-2 hover:decoration-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ControlDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, me, ready } = useAuth();

  const [control, setControl] = useState<Control | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const [assigneeId, setAssigneeId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    Promise.all([getControl(token, id), listEvidence(token, id)])
      .then(([c, e]) => {
        setControl(c);
        setEvidence(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load control'));
  }, [token, id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    listMembers(token).then(setMembers).catch(() => {});
  }, [token]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadEvidence(token, id, file, notes);
      setFile(null);
      setNotes('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !assigneeId || !taskTitle || !dueDate) return;
    setAssigning(true);
    setTaskMessage(null);
    try {
      await createTask(token, { controlId: id, assigneeId, title: taskTitle, dueDate });
      setTaskTitle('');
      setDueDate('');
      setTaskMessage('Task created.');
    } catch (err) {
      setTaskMessage(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setAssigning(false);
    }
  }

  if (!ready || !control) return null;

  return (
    <div>
      <header className="mb-6 border-b border-rule pb-3">
        <span className="font-mono text-[12px] text-ink-muted">{control.code}</span>
        <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.015em] text-ink">{control.title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{control.description}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-muted">
          <span>
            Category <span className="text-ink">{control.category}</span>
          </span>
          <span>
            Refresh every <span className="tabular font-mono text-ink">{control.refreshIntervalDays}</span> days
          </span>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">Evidence guidance</summary>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{control.evidenceGuidance}</p>
        </details>
      </header>

      {error && <Notice>{error}</Notice>}

      <section className="mb-8">
        <h2 className="mb-2 text-[13px] font-medium text-ink-muted">Evidence</h2>
        <RegisterHeader columns={['File', 'Collected', 'Notes & classification']} />
        {evidence.length === 0 ? (
          <RegisterEmpty>No evidence uploaded yet.</RegisterEmpty>
        ) : (
          evidence.map((row) => (
            <div key={row.id} className="flex gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <div className="flex-[1.4] min-w-0">
                <a
                  href={row.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[14px] font-medium text-ink underline decoration-rule underline-offset-2 hover:decoration-ink"
                >
                  {row.fileName}
                </a>
              </div>
              <div className="flex-1 tabular font-mono text-[12px] text-ink-muted">
                {new Date(row.collectedAt).toLocaleDateString()}
              </div>
              <div className="flex-1">
                {row.notes && <p className="text-[13px] text-ink-muted">{row.notes}</p>}
                <ClassificationPanel
                  controlId={id}
                  evidence={row}
                  canReview={Boolean(me && CAN_REVIEW_CLASSIFICATION.has(me.role))}
                  onReviewed={refresh}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {me && CAN_UPLOAD.has(me.role) && (
        <section className="mb-8 border-t border-rule pt-5">
          <h2 className="mb-3 text-[13px] font-medium text-ink-muted">Upload evidence</h2>
          <form onSubmit={handleUpload}>
            <div className="mb-4">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                className="block w-full text-[13px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-rule file:bg-paper-raised file:px-3 file:py-1.5 file:text-[13px] file:text-ink hover:file:border-ink-muted/50"
              />
            </div>
            <Field
              label="Notes"
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button type="submit" disabled={uploading || !file} className="w-auto">
              {uploading ? 'Uploading & classifying…' : 'Upload'}
            </Button>
          </form>
        </section>
      )}

      {me && CAN_ASSIGN.has(me.role) && (
        <section className="border-t border-rule pt-5">
          <h2 className="mb-3 text-[13px] font-medium text-ink-muted">Assign a task for this control</h2>
          <form onSubmit={handleAssign}>
            <div className="mb-4">
              <label className="mb-1.5 block text-[13px] font-medium text-ink">Assignee</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                required
                className="w-full rounded-sm border border-rule bg-paper-raised px-3 py-2.5 text-[14px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
              >
                <option value="">Select a member</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
            />
            <Field
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
            <Button type="submit" disabled={assigning} className="w-auto">
              {assigning ? 'Assigning…' : 'Assign'}
            </Button>
            {taskMessage && <p className="mt-2 text-[13px] text-ink-muted">{taskMessage}</p>}
          </form>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Visit a control's detail page. Confirm: uploading a real file shows a busy state, then the classification panel appears with confidence/reasoning once it returns. Confirm confirm/override/dismiss buttons appear only while `reviewStatus` is `PENDING`, and that clicking one updates the badge in place without a full page reload. Confirm the classification panel is still there after a hard refresh (`Cmd/Ctrl+R`) — this is the specific behavior Task 2's backend `include` exists to make possible; if it's missing after refresh, Task 2 wasn't actually picked up (rebuild `apps/api` and restart its dev server).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/controls/\[id\]/page.tsx
git commit -m "feat(web): rebuild the control detail page with evidence classification review"
```

---

### Task 7: Tasks page — visual rebuild

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tasks/page.tsx` (full rewrite — same data logic, new markup)

**Interfaces:**
- Consumes: `listTasks`, `updateTaskStatus` (existing, unchanged), `Badge`/`RegisterHeader`/`RegisterEmpty`/`RegisterSkeletonRows` (Task 4).

- [ ] **Step 1: Replace the file's contents**

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listTasks, updateTaskStatus } from '@/lib/api';
import { Badge } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

const STATUS_OPTIONS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const STATUS_TONE: Record<TaskStatus, 'verified' | 'expiring' | 'neutral'> = {
  DONE: 'verified',
  IN_PROGRESS: 'expiring',
  TODO: 'neutral',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

export default function TasksPage() {
  const { token, me, ready } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    listTasks(token, { status: filter || undefined })
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [token, filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    if (!token) return;
    try {
      await updateTaskStatus(token, taskId, status);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  }

  if (!ready) return null;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Tasks</h1>
        <span className="font-mono text-[11px] text-ink-muted">{loading ? '—' : `${tasks.length} shown`}</span>
      </header>
      <p className="mb-5 text-[13px] text-ink-muted">
        Assign a task from a control&apos;s own page. This view lists everything assigned across the workspace.
      </p>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as TaskStatus | '')}
        className="mb-5 rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
      >
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      {error && <p role="alert" className="mb-4 text-[13px] text-exception">{error}</p>}

      <RegisterHeader columns={['Title', 'Due', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={4} />
      ) : tasks.length === 0 ? (
        <RegisterEmpty>No tasks match this filter.</RegisterEmpty>
      ) : (
        tasks.map((task) => {
          // A CONTRIBUTOR may only move their own task — the server
          // enforces this on PATCH /tasks/:id/status regardless; this
          // just avoids rendering a control that would 403.
          const canChangeStatus =
            me?.role === 'OWNER' || me?.role === 'ADMIN' || task.assigneeId === me?.userId;
          return (
            <div key={task.id} className="flex items-center gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <span className="flex-[1.4] truncate text-[14px] font-medium text-ink">{task.title}</span>
              <span className="flex-1 tabular font-mono text-[12px] text-ink-muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
              </span>
              <span className="flex-1">
                {canChangeStatus ? (
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(task.id, e.target.value as TaskStatus)}
                    className="rounded-sm border border-rule bg-paper-raised px-2 py-1 text-[12px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Visit `/tasks`. Confirm the status filter narrows the list, and changing a task's status via its own select persists after a refresh.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/tasks/page.tsx
git commit -m "feat(web): rebuild the tasks page to match the design system"
```

---

### Task 8: Policy documents page (new)

**Files:**
- Create: `apps/web/src/app/(dashboard)/policy-documents/page.tsx`

**Interfaces:**
- Consumes: `uploadPolicyDocument`, `listPolicyDocuments` (Task 3), `Badge`/`RegisterHeader`/`RegisterEmpty`/`RegisterSkeletonRows` (Task 4).

- [ ] **Step 1: Create the page**

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PolicyDocStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listPolicyDocuments, uploadPolicyDocument } from '@/lib/api';
import { Badge, Button, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

// @Roles(OWNER, ADMIN, CONTRIBUTOR) on POST /policy-documents — same
// boundary as evidence upload, hidden client-side as a UX nicety only.
const CAN_UPLOAD = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR']);

const STATUS_LABEL: Record<PolicyDocStatus, string> = {
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

const STATUS_TONE: Record<PolicyDocStatus, 'verified' | 'expiring' | 'exception'> = {
  READY: 'verified',
  PROCESSING: 'expiring',
  FAILED: 'exception',
};

export default function PolicyDocumentsPage() {
  const { token, me, ready } = useAuth();
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listPolicyDocuments>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    listPolicyDocuments(token)
      .then(setDocuments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load policy documents'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadPolicyDocument(token, file);
      setFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Policy documents</h1>
        <span className="font-mono text-[11px] text-ink-muted">{loading ? '—' : `${documents.length} on file`}</span>
      </header>

      {error && <Notice>{error}</Notice>}

      {me && CAN_UPLOAD.has(me.role) && (
        <form onSubmit={handleUpload} className="mb-8 border-b border-rule pb-6">
          <p className="mb-3 text-[13px] text-ink-muted">
            PDF, plain text, or Markdown. Uploading processes the document immediately — this can take a few
            seconds for a longer file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="text-[13px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-rule file:bg-paper-raised file:px-3 file:py-1.5 file:text-[13px] file:text-ink hover:file:border-ink-muted/50"
            />
            <Button type="submit" disabled={uploading || !file} className="w-auto">
              {uploading ? 'Uploading & processing…' : 'Upload'}
            </Button>
          </div>
        </form>
      )}

      <RegisterHeader columns={['File', 'Uploaded', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={4} />
      ) : documents.length === 0 ? (
        <RegisterEmpty>No policy documents uploaded yet.</RegisterEmpty>
      ) : (
        documents.map((doc) => (
          <div key={doc.id} className="flex items-center gap-4 border-b border-rule py-3.5 pr-1 pl-1">
            <span className="flex-[1.4] truncate text-[14px] font-medium text-ink">{doc.fileName}</span>
            <span className="flex-1 tabular font-mono text-[12px] text-ink-muted">
              {new Date(doc.createdAt).toLocaleDateString()}
            </span>
            <span className="flex-1">
              <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Visit `/policy-documents` directly by URL (it has no nav entry yet — that's Task 10). Upload a real `.txt` file. Confirm the button shows a busy state for the full duration of the upload (this can take several seconds — it is a synchronous request that only resolves once chunking/embedding finishes server-side, not a fire-and-forget), then the new row appears with status `Ready`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/policy-documents/page.tsx
git commit -m "feat(web): add the policy documents page"
```

---

### Task 9: Gap analysis page (new)

**Files:**
- Create: `apps/web/src/app/(dashboard)/gap-analysis/page.tsx`

**Interfaces:**
- Consumes: `runGapAnalysis`, `getLatestGapAnalysis` (Task 3), `Badge`/`RegisterHeader`/`RegisterEmpty` (Task 4).

- [ ] **Step 1: Create the page**

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GapAnalysisReport } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { getLatestGapAnalysis, runGapAnalysis } from '@/lib/api';
import { Badge, Button, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader } from '@/components/register';

// @Roles(OWNER, ADMIN) on POST /gap-analysis/run — same boundary as
// every gated action on this page, hidden client-side as a UX nicety.
const CAN_RUN = new Set(['OWNER', 'ADMIN']);

export default function GapAnalysisPage() {
  const { token, me, ready } = useAuth();
  const [report, setReport] = useState<GapAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    getLatestGapAnalysis(token)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the latest report'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRun() {
    if (!token) return;
    setRunning(true);
    setError(null);
    try {
      const result = await runGapAnalysis(token);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap analysis run failed');
    } finally {
      setRunning(false);
    }
  }

  if (!ready) return null;

  const coveredCount = report?.results.filter((r) => r.covered).length ?? 0;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Gap analysis</h1>
        {report && (
          <span className="tabular font-mono text-[11px] text-ink-muted">
            {new Date(report.createdAt).toLocaleString()}
          </span>
        )}
      </header>

      {error && <Notice>{error}</Notice>}

      {me && CAN_RUN.has(me.role) && (
        <div className="mb-8 border-b border-rule pb-6">
          <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
            Checks every control against the uploaded policy documents. This can take a while — each control is
            checked individually against the policy library.
          </p>
          <Button type="button" onClick={handleRun} disabled={running} className="w-auto">
            {running ? 'Running gap analysis…' : 'Run gap analysis'}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-ink-muted">Loading the latest report…</p>
      ) : !report ? (
        <RegisterEmpty>No gap analysis has been run yet.</RegisterEmpty>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-ink-muted">
            <span className="tabular font-mono text-ink">{coveredCount}</span> of{' '}
            <span className="tabular font-mono text-ink">{report.results.length}</span> controls covered by an
            uploaded policy.
          </p>
          <RegisterHeader columns={['Control', 'Status', 'Reasoning & citation']} />
          {report.results.map((result) => (
            <div key={result.id} className="flex gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <div className="flex-[1.4] min-w-0">
                <span className="block font-mono text-[12px] text-ink-muted">{result.control.code}</span>
                <span className="block truncate text-[14px] font-medium text-ink">{result.control.title}</span>
              </div>
              <div className="flex-1">
                <Badge tone={result.covered ? 'verified' : 'exception'}>
                  {result.covered ? 'Covered' : 'Not covered'}
                </Badge>
              </div>
              <div className="flex-1">
                <p className="text-[13px] leading-relaxed text-ink-muted">{result.reasoning}</p>
                {result.citationChunk && (
                  <p className="mt-1.5 border-l-2 border-l-rule pl-2 text-[12px] text-ink-muted">
                    Citation:{' '}
                    <span className="font-medium text-ink">{result.citationChunk.document.fileName}</span>{' '}
                    <span className="tabular font-mono">(chunk {result.citationChunk.chunkIndex})</span>
                    <br />
                    <span className="italic">&ldquo;{result.citationChunk.content.slice(0, 160)}
                      {result.citationChunk.content.length > 160 ? '…' : ''}&rdquo;</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Visit `/gap-analysis` directly by URL. With at least one `READY` policy document uploaded (Task 8), click **Run gap analysis** and confirm the button shows a busy state for the whole run (this genuinely takes minutes against the real Gemini free tier per this session's earlier testing — do not mistake a long busy state for a hang), then the report renders with covered/not-covered badges and citation text for covered controls. Refresh the page and confirm `getLatestGapAnalysis` repopulates the same report without re-running it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/gap-analysis/page.tsx
git commit -m "feat(web): add the gap analysis page"
```

---

### Task 10: Sidebar navigation — add Policy Documents and Gap Analysis

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx:8-14` (the `NAV_ITEMS` array)

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Update `NAV_ITEMS`**

Change:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  // Evidence is uploaded/viewed from a control's own page (it's always
  // scoped to one control), not a standalone list — no separate nav entry.
  { href: '/controls', label: 'Controls' },
  { href: '/tasks', label: 'Tasks' },
];
```

to:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  // Evidence is uploaded/viewed from a control's own page (it's always
  // scoped to one control), not a standalone list — no separate nav entry.
  { href: '/controls', label: 'Controls' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/policy-documents', label: 'Policy documents' },
  { href: '/gap-analysis', label: 'Gap analysis' },
];
```

Nothing else in the file changes — the existing `active`/`aria-current` logic already works for any `href` in this array.

- [ ] **Step 2: Build and lint**

Run: `npm run build -w apps/web && npm run lint -w apps/web`
Expected: both exit 0.

- [ ] **Step 3: Manual check against the dev server**

Confirm both new items appear in the sidebar (and the mobile horizontal nav strip), navigate to each via the nav link rather than a typed URL, and confirm the active-state marker (bottom rule on mobile, left rule + `bg-paper-raised` on desktop) applies correctly including on the nested `/controls/:id` route still marking `Controls` active.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add Policy Documents and Gap Analysis to the sidebar nav"
```

---

## Self-Review

**Spec coverage:**
- Controls page (list, filter by category, click-through to detail) — Task 5. ✓
- Control detail (detail, evidence history, upload form) — Task 6. ✓
- Evidence upload flow with AI classification suggestion + confirm/override/dismiss — Task 6 (`ClassificationPanel`), backed by Task 2's required data fix. ✓
- Tasks page (list, assign from control page, update status) — assign-from-control already existed in Task 6's carried-over form; list + status update — Task 7. ✓
- Policy documents page (upload, library list with status) — Task 8. ✓
- Gap analysis page (run button, report view with reasoning + citation) — Task 9. ✓
- "Use the existing design system... don't introduce a new visual style" — every task reuses `globals.css` tokens and either extends or matches `ui.tsx`/`DashboardPage`'s established patterns (Task 4's `Badge`/`register.tsx` are the only new primitives, and they're built from existing tokens, not new ones). ✓
- "No new backend logic" — one explicitly user-approved exception (Task 2), scoped to a single `include`. ✓

**Placeholder scan:** No TBD/TODO/"add appropriate handling" — every step has complete code. Task 2's Step 2 test names fixture variables it asks the implementer to verify against the file's real fixture names rather than guessing, which is a legitimate escape hatch (the file wasn't fully reproduced in this plan to avoid drift from its actual current state), not a placeholder — the assertions themselves are concrete.

**Type consistency:** `Evidence['classification']` (Task 1) is the type every later task's classification code destructures against (`ClassificationPanel`'s props, `reviewClassification`'s return type in Task 3). `GapAnalysisReport`/`GapAnalysisResult`/`PolicyChunkRef` (Task 1) match exactly what Task 9 renders. `PolicyDocument`/`PolicyDocStatus` (Task 1) match Task 8. Function names (`reviewClassification`, `uploadPolicyDocument`, `listPolicyDocuments`, `runGapAnalysis`, `getLatestGapAnalysis` — Task 3) are used identically in Tasks 6, 8, 9.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-06-frontend-pages.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
