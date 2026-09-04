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
