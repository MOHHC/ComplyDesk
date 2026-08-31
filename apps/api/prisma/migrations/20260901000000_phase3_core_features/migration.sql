-- Phase 3: schema changes for controls seeding, evidence file metadata,
-- an expanded Role model, and the AuditEvent table, plus the RLS/grants
-- that go with them. Hand-written and idempotent, same convention as the
-- earlier RLS migrations, for the same reason: CREATE ROLE-adjacent
-- statements aren't used here, but ALTER TYPE ... ADD VALUE has its own
-- one-shot restriction (a value added in this transaction can't be used
-- by a DML statement in the *same* transaction), so this file is written
-- to tolerate re-running cleanly rather than assuming single-shot success.

-- ---------------------------------------------------------------------
-- Role: MEMBER becomes CONTRIBUTOR (renamed, not replaced — no data
-- exists in either environment yet, but a rename is still the correct
-- operation, not a drop+recreate, since it preserves anything already
-- persisted). AUDITOR is new: a read-only role across every resource.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role' AND e.enumlabel = 'MEMBER'
  ) THEN
    ALTER TYPE "Role" RENAME VALUE 'MEMBER' TO 'CONTRIBUTOR';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role' AND e.enumlabel = 'AUDITOR'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'AUDITOR';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Evidence: fileUrl (a placeholder from the original scaffold, never
-- used) is replaced with the real object-storage metadata. The bucket is
-- private, so what's stored is a key, not a browsable URL — downloads go
-- through a short-lived presigned URL generated on request.
-- ---------------------------------------------------------------------
ALTER TABLE "Evidence" DROP COLUMN IF EXISTS "fileUrl";
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "fileKey" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
-- NOT NULL added as a separate statement so re-running this file after
-- the columns already exist (and are already NOT NULL) is a no-op rather
-- than an error; there are no existing Evidence rows in either
-- environment to violate this backfilling in.
ALTER TABLE "Evidence" ALTER COLUMN "fileKey" SET NOT NULL;
ALTER TABLE "Evidence" ALTER COLUMN "fileName" SET NOT NULL;
ALTER TABLE "Evidence" ALTER COLUMN "fileSize" SET NOT NULL;
ALTER TABLE "Evidence" ALTER COLUMN "mimeType" SET NOT NULL;

DROP INDEX IF EXISTS "Evidence_tenantId_controlId_idx";
CREATE INDEX IF NOT EXISTS "Evidence_tenantId_controlId_collectedAt_idx"
  ON "Evidence" ("tenantId", "controlId", "collectedAt");

-- ---------------------------------------------------------------------
-- AuditEvent: an append-only log of mutating requests. Tenant-owned like
-- Control/Evidence/Task, so it gets the same RLS treatment. app_runtime
-- is granted SELECT and INSERT only — deliberately no UPDATE or DELETE,
-- so even the app's own runtime role cannot alter or remove an audit
-- row; that has to go through neondb_owner out-of-band, which is the
-- point of an audit trail.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "actorUserId" TEXT,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT NOT NULL,
  "targetId"    TEXT,
  "diff"        JSONB,
  "method"      TEXT NOT NULL,
  "path"        TEXT NOT NULL,
  "statusCode"  INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId")
    REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "AuditEvent_tenantId_createdAt_idx"
  ON "AuditEvent" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_tenantId_targetType_targetId_idx"
  ON "AuditEvent" ("tenantId", "targetType", "targetId");

GRANT SELECT, INSERT ON "AuditEvent" TO app_runtime;

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "AuditEvent";
CREATE POLICY tenant_isolation ON "AuditEvent"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);
