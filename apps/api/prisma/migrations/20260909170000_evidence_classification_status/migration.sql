-- Distinguish "classification failed" from "classification completed with
-- no confident match" from "never attempted" in the UI, per a real user
-- report: a Gemini 503 during evidence classification left EvidenceService
-- with no row at all for that evidence (same shape as "never attempted"
-- and as a rate-limited skip), which the UI rendered identically to a
-- genuinely-unclassified upload -- "No AI classification for this file" --
-- with no way to tell what happened or retry it.
--
-- ClassificationStatus makes the outcome of an attempt explicit and
-- persisted, independent of ReviewStatus (which is about the human's
-- decision on a suggestion, not whether the AI produced one). Existing
-- rows are all past-successful classifications -- DEFAULT 'COMPLETED'
-- backfills them correctly with no data migration needed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassificationStatus') THEN
    CREATE TYPE "ClassificationStatus" AS ENUM ('COMPLETED', 'FAILED');
  END IF;
END
$$;

ALTER TABLE "EvidenceClassification"
  ADD COLUMN IF NOT EXISTS "status" "ClassificationStatus" NOT NULL DEFAULT 'COMPLETED';
