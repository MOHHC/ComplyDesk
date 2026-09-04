-- Phase 5 AI layer follow-up: add the missing tenantId -> Tenant foreign
-- keys on the five tables introduced by 20260901120000_ai_layer.
--
-- schema.prisma has always declared these as `onDelete: Cascade` relations,
-- but the hand-written migration.sql for that table set never actually
-- added the constraint at the database level (unlike every other
-- tenant-owned table -- Membership/Control/Evidence/Task in
-- 20260831015655_init, AuditEvent in 20260901000000_phase3_core_features --
-- which all carry an explicit "<Table>_tenantId_fkey" FK with
-- ON DELETE CASCADE ON UPDATE CASCADE). Discovered during Task 15's
-- adversarial RLS work: deleting a Tenant left these five tables' rows
-- behind indefinitely, orphaned. Not an RLS/tenant-isolation issue -- FK
-- integrity checks run as the table owner, so this introduces no
-- cross-tenant read vector -- purely a referential-integrity /
-- data-retention gap.
--
-- 20260901120000_ai_layer/migration.sql is already applied (including to
-- the Neon test branch) and is left untouched; this is a new forward
-- migration, per this project's convention of never editing an applied
-- migration.
--
-- Step 0: pre-flight corruption guard, before any DELETE runs.
--
-- PolicyChunk.documentId -> PolicyDocument and GapAnalysisResult.runId ->
-- GapAnalysisRun are themselves ON DELETE CASCADE (see
-- 20260901120000_ai_layer/migration.sql:58,83). That means Step 1 below,
-- which deletes an orphaned PolicyDocument or GapAnalysisRun (one whose
-- own tenantId no longer matches any Tenant), would silently cascade into
-- *any* row referencing it -- including a child whose own tenantId is
-- perfectly valid and belongs to a live tenant, if such a parent/child
-- mismatch ever existed. A plain "WHERE tenantId NOT IN (...)" filter on
-- the child tables (as used below) only catches children that are
-- themselves orphaned; it gives no protection along this cascade path.
--
-- This should be unproducible through the application: RLS's WITH CHECK
-- on both the parent and child tables ties a row's own tenantId to
-- app.tenant_id at write time, so a live-tenant child can only ever be
-- created pointing at a live-tenant parent. But "should never happen"
-- and "cannot happen" are not the same thing when the failure mode is
-- silently deleting a live customer's data -- so this guard exists to
-- turn an unproducible-in-theory mismatch into a loud, non-destructive
-- failure if the data is ever found to be corrupt in practice, rather
-- than trusting that assumption at migration time. Both checks below
-- must run before Step 1's DELETEs, while the potentially-orphaned
-- parent rows still exist to be joined against.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "PolicyChunk" pc
  JOIN "PolicyDocument" pd ON pd.id = pc."documentId"
  WHERE pc."tenantId" IN (SELECT "id" FROM "Tenant")
    AND pd."tenantId" NOT IN (SELECT "id" FROM "Tenant");

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'ABORTING 20260901150000_ai_layer_tenant_fk: % PolicyChunk row(s) belong to a live tenant but reference a PolicyDocument that is about to be deleted as an orphan (its tenantId matches no row in Tenant). PolicyChunk.documentId is ON DELETE CASCADE, so deleting that PolicyDocument would silently destroy this live-tenant PolicyChunk. This should be unproducible via the app (RLS WITH CHECK ties tenantId together on both tables) and indicates genuinely corrupt data -- do not force past this. Inspect with: SELECT pc.id, pc."tenantId", pc."documentId", pd."tenantId" AS "documentTenantId" FROM "PolicyChunk" pc JOIN "PolicyDocument" pd ON pd.id = pc."documentId" WHERE pc."tenantId" IN (SELECT "id" FROM "Tenant") AND pd."tenantId" NOT IN (SELECT "id" FROM "Tenant");',
      bad_count;
  END IF;
END
$$;

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "GapAnalysisResult" gr
  JOIN "GapAnalysisRun" run ON run.id = gr."runId"
  WHERE gr."tenantId" IN (SELECT "id" FROM "Tenant")
    AND run."tenantId" NOT IN (SELECT "id" FROM "Tenant");

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'ABORTING 20260901150000_ai_layer_tenant_fk: % GapAnalysisResult row(s) belong to a live tenant but reference a GapAnalysisRun that is about to be deleted as an orphan (its tenantId matches no row in Tenant). GapAnalysisResult.runId is ON DELETE CASCADE, so deleting that GapAnalysisRun would silently destroy this live-tenant GapAnalysisResult. This should be unproducible via the app (RLS WITH CHECK ties tenantId together on both tables) and indicates genuinely corrupt data -- do not force past this. Inspect with: SELECT gr.id, gr."tenantId", gr."runId", run."tenantId" AS "runTenantId" FROM "GapAnalysisResult" gr JOIN "GapAnalysisRun" run ON run.id = gr."runId" WHERE gr."tenantId" IN (SELECT "id" FROM "Tenant") AND run."tenantId" NOT IN (SELECT "id" FROM "Tenant");',
      bad_count;
  END IF;
END
$$;

-- GapAnalysisResult.citationChunkId -> PolicyChunk is ON DELETE SET NULL,
-- not CASCADE, so it does not fit the same failure mode: deleting an
-- orphaned PolicyChunk below can never delete a live-tenant
-- GapAnalysisResult through this FK, only null out its citationChunkId.
-- That citation was already dangling to a chunk belonging to an orphaned
-- (about-to-be-deleted) PolicyDocument, so nulling it is reasonable
-- rather than corrupting -- but it is a real, visible side effect worth
-- flagging (see the note at Step 1's PolicyChunk DELETE below), not a
-- silent data-loss vector, so it gets a comment rather than a guard.
--
-- Step 1: clean up any rows already orphaned by a tenantId with no
-- matching Tenant (Task 15's test runs and earlier development may have
-- left some -- ADD CONSTRAINT fails outright otherwise). Deleted in an
-- order that respects the five tables' own inter-table FKs so the cleanup
-- itself never hits a constraint violation: GapAnalysisResult references
-- GapAnalysisRun (and PolicyChunk, nullable); PolicyChunk references
-- PolicyDocument; GapAnalysisRun, PolicyDocument, and
-- EvidenceClassification have no other new-table dependents. Each DELETE
-- is naturally idempotent -- once orphans are gone, re-running deletes
-- zero rows.
DELETE FROM "GapAnalysisResult"
  WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

DELETE FROM "GapAnalysisRun"
  WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

-- Note: any live-tenant GapAnalysisResult whose citationChunkId points at
-- one of the orphaned PolicyChunk rows deleted here has that citation set
-- to NULL by GapAnalysisResult_citationChunkId_fkey's existing
-- ON DELETE SET NULL (20260901120000_ai_layer/migration.sql:87). That
-- citation was already dangling to a chunk belonging to an orphaned
-- PolicyDocument, so this is expected, not a no-op -- flagged so a future
-- reader isn't surprised by a citationChunkId disappearing.
DELETE FROM "PolicyChunk"
  WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

DELETE FROM "PolicyDocument"
  WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

DELETE FROM "EvidenceClassification"
  WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

-- Step 2: add the constraints, matching the exact form used by the
-- pre-existing tenant-owned tables (name "<Table>_tenantId_fkey",
-- ON DELETE CASCADE ON UPDATE CASCADE). Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS", so each is wrapped in a pg_constraint
-- existence check for idempotency, same reasoning as the DO $$ guards in
-- 20260901000000_phase3_core_features and 20260901120000_ai_layer: Neon's
-- shadow-database replay and manual re-runs both need this file to be
-- safely re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvidenceClassification_tenantId_fkey'
  ) THEN
    ALTER TABLE "EvidenceClassification" ADD CONSTRAINT "EvidenceClassification_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PolicyDocument_tenantId_fkey'
  ) THEN
    ALTER TABLE "PolicyDocument" ADD CONSTRAINT "PolicyDocument_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PolicyChunk_tenantId_fkey'
  ) THEN
    ALTER TABLE "PolicyChunk" ADD CONSTRAINT "PolicyChunk_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GapAnalysisRun_tenantId_fkey'
  ) THEN
    ALTER TABLE "GapAnalysisRun" ADD CONSTRAINT "GapAnalysisRun_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GapAnalysisResult_tenantId_fkey'
  ) THEN
    ALTER TABLE "GapAnalysisResult" ADD CONSTRAINT "GapAnalysisResult_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
