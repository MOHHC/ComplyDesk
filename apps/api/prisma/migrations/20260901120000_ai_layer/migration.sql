-- Phase 5 AI layer: evidence auto-classification + policy gap analysis.
-- Same tenant-isolation treatment as every existing RLS-protected table
-- (see 20260831140238_add_rls_and_app_runtime_role): ENABLE + FORCE ROW
-- LEVEL SECURITY, the same tenant_isolation policy, GRANT to
-- app_runtime, and a leading-tenantId composite index. Idempotent
-- throughout, for the same reason the earlier RLS migration is — Neon's
-- shadow-database replay and manual re-runs must both be safe.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewStatus') THEN
    CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN', 'DISMISSED');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PolicyDocStatus') THEN
    CREATE TYPE "PolicyDocStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "EvidenceClassification" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL UNIQUE REFERENCES "Evidence"("id") ON DELETE CASCADE,
  "suggestedControlId" TEXT REFERENCES "Control"("id") ON DELETE SET NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reasoning" TEXT NOT NULL,
  "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "EvidenceClassification_tenantId_reviewStatus_idx"
  ON "EvidenceClassification" ("tenantId", "reviewStatus");

CREATE TABLE IF NOT EXISTS "PolicyDocument" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "status" "PolicyDocStatus" NOT NULL DEFAULT 'PROCESSING',
  "uploadedById" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PolicyDocument_tenantId_createdAt_idx"
  ON "PolicyDocument" ("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "PolicyChunk" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL REFERENCES "PolicyDocument"("id") ON DELETE CASCADE,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS "PolicyChunk_tenantId_documentId_idx"
  ON "PolicyChunk" ("tenantId", "documentId");
-- ivfflat's `lists` tuning assumes a nontrivial row count; a small fixed
-- value is fine at this project's scale and still works (just less
-- optimally) while the table is small.
CREATE INDEX IF NOT EXISTS "PolicyChunk_embedding_idx"
  ON "PolicyChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS "GapAnalysisRun" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "runById" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "GapAnalysisRun_tenantId_createdAt_idx"
  ON "GapAnalysisRun" ("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "GapAnalysisResult" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL REFERENCES "GapAnalysisRun"("id") ON DELETE CASCADE,
  "controlId" TEXT NOT NULL REFERENCES "Control"("id") ON DELETE CASCADE,
  "covered" BOOLEAN NOT NULL,
  "reasoning" TEXT NOT NULL,
  "citationChunkId" TEXT REFERENCES "PolicyChunk"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "GapAnalysisResult_tenantId_runId_idx"
  ON "GapAnalysisResult" ("tenantId", "runId");

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "EvidenceClassification", "PolicyDocument", "PolicyChunk", "GapAnalysisRun", "GapAnalysisResult"
TO app_runtime;

ALTER TABLE "EvidenceClassification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceClassification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PolicyDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PolicyChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyChunk" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GapAnalysisRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GapAnalysisRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GapAnalysisResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GapAnalysisResult" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "EvidenceClassification";
CREATE POLICY tenant_isolation ON "EvidenceClassification"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "PolicyDocument";
CREATE POLICY tenant_isolation ON "PolicyDocument"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "PolicyChunk";
CREATE POLICY tenant_isolation ON "PolicyChunk"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "GapAnalysisRun";
CREATE POLICY tenant_isolation ON "GapAnalysisRun"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "GapAnalysisResult";
CREATE POLICY tenant_isolation ON "GapAnalysisResult"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);
