# Phase 5 — AI Layer: Design Spec

Status: Approved for implementation planning
Date: 2026-09-01

## Summary

Two tenant-scoped AI features, both gated behind human confirmation, both using OpenAI:

1. **Evidence auto-classification** — when evidence is uploaded to a control, an LLM suggests
   which control it actually satisfies. The suggestion is shown alongside the evidence; it never
   changes the evidence's filing on its own. The user confirms, dismisses, or overrides (moves the
   evidence to the suggested control).
2. **Policy gap analysis** — a user uploads their existing policy documents; they're chunked and
   embedded into pgvector on the existing Postgres database. On demand, the app checks each of the
   18 baseline controls against the embedded policy content and produces a gap report: covered
   controls with a citation to the source chunk, uncovered controls with none found.

Both features run entirely inline on the triggering HTTP request — no background job queue exists
in this project and neither feature justifies introducing one. Both are rate-limited per tenant
since every call reaches a paid external API.

## Decisions already made (not open for revisiting in this doc)

- **LLM provider: OpenAI**, for both chat/vision completions and embeddings — one vendor, one API
  key, embeddings and completions from the same provider.
- **Image evidence → GPT-4o (vision) directly**, no separate OCR step.
- **Classification runs synchronously on upload** — the upload request itself calls OpenAI and
  returns the suggestion in the response.
- **Gap analysis is triggered on demand** by an explicit "Run gap analysis" action, not
  automatically on every policy upload.
- **Classification confirms-or-flags a mismatch** against the control the user already picked at
  upload time — it does not introduce a second, control-agnostic upload entry point.
- **Vector storage: pgvector on the existing Neon Postgres database**, not a separate vector store.

## Out of scope for this phase (explicitly deferred)

- No background job/queue infrastructure (BullMQ or otherwise) — both features run inline.
- No re-filing evidence to a third control from the review action — `override` only moves evidence
  to the control the AI itself suggested.
- No DOCX support for policy documents (PDF and plain text/Markdown only).
- No OCR fallback for scanned/image-only PDFs (no text layer) — these get
  `confidence: 0, reasoning: "no extractable text"` rather than a rasterize-to-image fallback.
- No Redis-backed multi-instance rate limiting — matches the existing accepted limitation on
  `WorkspaceLookupThrottleGuard`.

## Data model

All new tables get the exact same tenant-isolation treatment as `Membership`/`Control`/
`Evidence`/`Task`: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, the same
`tenant_isolation` policy (`USING`/`WITH CHECK` on `"tenantId"::uuid = current_setting('app.tenant_id')::uuid`),
`GRANT SELECT, INSERT, UPDATE, DELETE ... TO app_runtime`, and a leading-`tenantId` composite index.
This is mechanical, following the existing `add_rls_and_app_runtime_role` migration's pattern
exactly — no new isolation mechanism is introduced.

```prisma
enum ReviewStatus {
  PENDING
  CONFIRMED
  OVERRIDDEN
  DISMISSED
}

enum PolicyDocStatus {
  PROCESSING
  READY
  FAILED
}

model EvidenceClassification {
  id                 String       @id @default(uuid())
  tenantId           String
  evidenceId         String       @unique // one suggestion per evidence row
  suggestedControlId String?               // null if the model found no match
  confidence         Float                 // 0..1
  reasoning          String                // short LLM-authored justification
  reviewStatus       ReviewStatus @default(PENDING)
  reviewedById       String?
  reviewedAt         DateTime?
  createdAt          DateTime     @default(now())

  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  evidence         Evidence @relation(fields: [evidenceId], references: [id], onDelete: Cascade)
  suggestedControl Control? @relation(fields: [suggestedControlId], references: [id], onDelete: SetNull)
  reviewedBy       User?    @relation(fields: [reviewedById], references: [id], onDelete: SetNull)

  @@index([tenantId, reviewStatus])
}

model PolicyDocument {
  id           String          @id @default(uuid())
  tenantId     String
  fileKey      String          // object storage, tenant-prefixed, same pattern as Evidence.fileKey
  fileName     String
  mimeType     String
  status       PolicyDocStatus @default(PROCESSING)
  uploadedById String
  createdAt    DateTime        @default(now())

  tenant     Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  uploadedBy User          @relation(fields: [uploadedById], references: [id])
  chunks     PolicyChunk[]

  @@index([tenantId, createdAt])
}

model PolicyChunk {
  id         String   @id @default(uuid())
  tenantId   String
  documentId String
  chunkIndex Int
  content    String
  // pgvector column; text-embedding-3-small produces 1536-dim vectors.
  // Prisma has no native vector type — declared via Unsupported() and
  // managed through raw SQL in the migration (see below).
  embedding  Unsupported("vector(1536)")

  document PolicyDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  tenant   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, documentId])
}

model GapAnalysisRun {
  id       String   @id @default(uuid())
  tenantId String
  runById  String
  createdAt DateTime @default(now())

  tenant  Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  runBy   User                @relation(fields: [runById], references: [id])
  results GapAnalysisResult[]

  @@index([tenantId, createdAt])
}

model GapAnalysisResult {
  id              String  @id @default(uuid())
  tenantId        String
  runId           String
  controlId       String
  covered         Boolean
  reasoning       String
  citationChunkId String?

  run             GapAnalysisRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  tenant          Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  control         Control        @relation(fields: [controlId], references: [id], onDelete: Cascade)
  citationChunk   PolicyChunk?   @relation(fields: [citationChunkId], references: [id], onDelete: SetNull)

  @@index([tenantId, runId])
}
```

Migration notes:
- `CREATE EXTENSION IF NOT EXISTS vector;` — verify enabled on both `test` and `production`
  branches as part of applying this migration (idempotent either way).
- The `vector(1536)` column and its ivfflat/hnsw similarity index are created via raw SQL in the
  migration, since Prisma's schema DSL can't express pgvector's index types — this is the same
  "Prisma migrate deploy applies raw SQL, doesn't diff the schema" model already in use.
- `app_runtime` gets `GRANT SELECT, INSERT, UPDATE, DELETE` on all five new tables, same as
  existing tenant-owned tables.

## B. Evidence classification (inline, on upload)

`EvidenceService.upload()` gains one step after the `Evidence` row is inserted, in the same
request handler:

1. **Image mimeType** → send the image bytes directly to a vision-capable OpenAI model (GPT-4o)
   with a prompt listing the tenant's 18 control codes/titles/descriptions, requesting structured
   JSON via OpenAI's structured-output/JSON-schema mode:
   `{ suggestedControlCode: string | null, confidence: number, reasoning: string }`.
2. **`application/pdf`** → extract text server-side with `pdf-parse`, then send the extracted text
   through the same prompt (text-only model, cheaper). If extraction yields near-empty text (a
   scanned PDF with no text layer), skip the LLM call and record
   `confidence: 0, reasoning: "no extractable text"` directly.
3. **Anything else** (plain text, markdown, etc.) → send the raw text through the text-only prompt.
4. Write the `EvidenceClassification` row, `reviewStatus: PENDING`.
5. Include the classification in the upload response.

Failure handling: if the OpenAI call throws or times out, the evidence upload still succeeds —
classification is best-effort annotation, never a blocker on the file actually being saved. The
response's `classification` field is `null` in that case; there is no automatic retry.

**Review endpoint:**
`PATCH /controls/:controlId/evidence/:evidenceId/classification`
Body: `{ decision: 'confirm' | 'override' | 'dismiss' }`

- `confirm` — AI agreed with the existing placement; sets `reviewStatus: CONFIRMED`. No data
  changes beyond the classification row.
- `dismiss` — AI suggested a different control, but the user is keeping the evidence where it is;
  sets `reviewStatus: DISMISSED`. No data changes beyond the classification row.
- `override` — moves the evidence: `evidence.controlId = suggestedControlId`, sets
  `reviewStatus: OVERRIDDEN`, and writes an audit log entry for the move (existing
  `@Audit()` pattern, `action: 'evidence.reclassify'`). Requires `suggestedControlId` to be
  non-null (400 otherwise — nothing to move to).

All three record `reviewedById`/`reviewedAt`. Same role gate as evidence upload
(`OWNER`/`ADMIN`/`CONTRIBUTOR`).

## C. Policy gap analysis

**Upload:** `POST /policy-documents` (multipart; accepted mimeTypes: `application/pdf`,
`text/plain`, `text/markdown` — no DOCX in this phase).

1. Store the file in object storage under a `policy-docs/` prefix (same tenant-scoped
   `ObjectStorageService`, mirroring `Evidence.fileKey`'s pattern).
2. Create `PolicyDocument(status: PROCESSING)`.
3. Extract text (same `pdf-parse` path as evidence, or read directly for text/markdown).
4. Chunk (~800 tokens per chunk, ~100 token overlap between consecutive chunks).
5. Embed each chunk via `text-embedding-3-small`; write `PolicyChunk` rows.
6. Flip `status` to `READY`, or `FAILED` if extraction/embedding errors (failure reason logged
   server-side, not stored on the row — matches the "don't store secrets/noise on the model"
   style already in place elsewhere).

Runs inline like evidence upload: this is a user-initiated action they're already waiting on, and
there's no queue infrastructure to hand it off to.

**Listing:** `GET /policy-documents` — the document library (name, status, uploadedAt).

**Running an analysis:** `POST /gap-analysis/run`

For each of the tenant's 18 controls:
1. Embed the control's own description (cached per tenant — static input, no reason to re-embed
   every run).
2. pgvector cosine-similarity search (`<=>` operator) over that tenant's `PolicyChunk` rows,
   top 5 matches.
3. One LLM call: control text + the 5 candidate chunks → "does this evidence support that the
   control is addressed? If yes, which chunk index most directly supports it?" → structured
   `{ covered: boolean, reasoning: string, citedChunkIndex: number | null }`.
4. Write one `GapAnalysisResult` row.

All 18 calls run under a small concurrency cap (`Promise.all` batched, e.g. 4 at a time — not
strictly sequential, not unbounded parallel), grouped under one `GapAnalysisRun`.

**Reading the report:** `GET /gap-analysis/latest` — the most recent run's 18 results, each with
its control, covered/not-covered, reasoning, and (if covered) the cited chunk's content + source
document name for the frontend to render as a citation.

If a tenant has zero `PolicyChunk` rows when `/gap-analysis/run` is called, skip the LLM entirely
and write all 18 results as `covered: false, reasoning: "No policy documents uploaded"` — no
wasted API calls on an empty corpus.

## D. Rate limiting

New `TenantRateLimitGuard`: same fixed-window shape as the existing
`WorkspaceLookupThrottleGuard`, but keyed by `cls.get('tenantId')` (available here, since these
routes require authentication) instead of IP. Configured per-route via a `@RateLimit(name, max)`
decorator reading from a small named-limit map:

- `classification` — 30 requests/hour/tenant (tied 1:1 to evidence uploads, generous headroom).
- `gapAnalysis` — 5 requests/hour/tenant (a single run is 18 LLM calls — a tighter cap makes
  sense).

In-memory/per-process, same documented, accepted limitation as the existing guard (does not hold
across a multi-instance deployment; Redis is the future fix, not built now).

## E. AI provider abstraction & testing

`AiProvider` interface, one real implementation and one fake, selected via a DI token
(`AI_PROVIDER`) — the same shape the project already uses for `ObjectStorageService` pointing at
Neon's S3-compatible storage rather than real AWS:

```ts
interface AiProvider {
  classifyEvidence(input: { mimeType: string; content: Buffer | string; controls: ControlSummary[] })
    : Promise<{ suggestedControlCode: string | null; confidence: number; reasoning: string }>;
  embed(text: string): Promise<number[]>;
  checkControlCoverage(input: { control: ControlSummary; candidateChunks: ChunkSummary[] })
    : Promise<{ covered: boolean; reasoning: string; citedChunkIndex: number | null }>;
}
```

- `OpenAiProvider` — real implementation, calls the OpenAI API (chat completions with
  structured/JSON-schema output for vision + text classification and coverage checks;
  `text-embedding-3-small` for `embed`).
- `FakeAiProvider` — deterministic, no network calls, used in unit and e2e tests. Returns
  fixture-driven responses (e.g. keyed by a marker string in the input) so tests can assert on
  specific classification/coverage outcomes without hitting a real API — this preserves the
  suite's stability work from the previous phase (capped workers, no flakiness from external
  latency, no real API cost per test run).

`OPENAI_API_KEY` is a single environment variable, not Neon-branch-scoped (unlike the database and
object-storage credentials) — both `test` and `production` point at the same OpenAI account, but
tests never call it, since `FakeAiProvider` is what's wired in the test module.

## API surface summary

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/controls/:controlId/evidence/:evidenceId/classification` | confirm/override/dismiss a classification |
| POST | `/policy-documents` | upload a policy document |
| GET | `/policy-documents` | list policy documents |
| POST | `/gap-analysis/run` | run a new gap analysis |
| GET | `/gap-analysis/latest` | fetch the most recent report |

(Evidence upload's existing `POST /controls/:controlId/evidence` response gains a `classification`
field; no new endpoint needed there.)

## Testing strategy

- Unit tests for chunking (boundary/overlap correctness), the pgvector similarity query, and the
  rate limit guard's window/reset behavior.
- e2e tests using `FakeAiProvider`, covering: classification suggestion attached to an upload
  response; confirm/override/dismiss each producing the right `reviewStatus` and (for override)
  the right `evidence.controlId` + audit log entry; policy upload → chunk/embed → gap analysis run
  → report reflecting fixture-driven covered/not-covered outcomes; rate limit enforcement (30th/6th
  request in a window rejected); and cross-tenant isolation probes for all five new tables
  (adversarial, as `app_runtime`, matching the existing RLS isolation tests' style — attempted
  reads/writes across tenants, not just happy-path checks).
