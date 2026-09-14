-- `prisma migrate dev` generated this against pre-existing, already-known
-- drift (see the old drift notes: a benign ivfflat-index "drop" Prisma
-- can't express, plus FK ON UPDATE churn from an unrelated schema/DB
-- disagreement) and bundled both into this diff. Neither belongs in a
-- migration whose only real intent is the demo-tenant flag, so this file
-- was trimmed by hand down to that one statement.
ALTER TABLE "Tenant" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;
