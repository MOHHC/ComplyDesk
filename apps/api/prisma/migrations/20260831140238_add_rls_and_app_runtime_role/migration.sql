-- Row-Level Security for tenant-owned tables, and a least-privilege
-- runtime role to enforce it against.
--
-- Neon gotcha #1 (verified against this project's branches before
-- writing this): roles created through Neon's own role-management
-- API/CLI (`neon roles create`) get BYPASSRLS by default, and Postgres
-- ignores RLS entirely for BYPASSRLS roles regardless of ENABLE/FORCE —
-- so a Neon-CLI-created role can never actually be constrained by the
-- policies below. Creating the role with plain SQL here avoids that:
-- a plain `CREATE ROLE` has no BYPASSRLS by default, and (Postgres 16+)
-- the creating role automatically gets ADMIN OPTION on roles it creates
-- this way, which is what lets the immediately-following
-- `ALTER ROLE ... NOBYPASSRLS` succeed at all.
--
-- Neon gotcha #2: `CREATE ROLE` is cluster-wide, not database-scoped,
-- so `prisma migrate dev`'s shadow-database validation pass (which
-- replays the whole migration against a throwaway database first)
-- creates this role for real as a side effect, before the migration
-- ever reaches the actual target database — causing a plain
-- `CREATE ROLE app_runtime` to collide with itself on every run. Every
-- statement below is written to be idempotent so this migration is
-- safe to apply regardless of that.
--
-- The password below is a placeholder — rotate it immediately after
-- this migration runs (`ALTER ROLE app_runtime PASSWORD '...'`, never
-- committed) before pointing the app at this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY_AFTER_MIGRATION';
  END IF;
END
$$;
ALTER ROLE app_runtime NOBYPASSRLS;

-- Known limitation: neondb_owner (the table owner, used only for
-- migrations) also has BYPASSRLS by default on this platform, and
-- unlike app_runtime above, neondb_owner did not create itself — Neon's
-- own provisioning did — so neondb_owner lacks ADMIN OPTION on itself
-- and `ALTER ROLE neondb_owner NOBYPASSRLS` fails with "permission
-- denied to alter role" even though neondb_owner has CREATEROLE. That
-- requires Neon-side/console access this project doesn't have. FORCE
-- ROW LEVEL SECURITY below is still the correct, standard configuration
-- (and fully constrains app_runtime, the actual runtime path, and any
-- future non-BYPASSRLS role) — it just does not currently constrain
-- neondb_owner specifically, since BYPASSRLS overrides FORCE
-- unconditionally per Postgres semantics. Nothing in the running app
-- ever connects as neondb_owner, so this doesn't weaken the app's own
-- tenant isolation; it only means an operator manually connected as
-- neondb_owner (e.g. via `neon psql`) still sees all tenants' rows.

-- app_runtime is the only role the running app connects as. It needs
-- DML on every table the app touches — Tenant/User have no RLS (they
-- aren't tenant-owned rows in the same sense: Tenant *is* the tenant,
-- User is a global identity that joins tenants via Membership) — plus
-- the four RLS-protected tables below. No DDL/schema privileges: schema
-- changes only ever happen through migrations, run as the owner role.
-- GRANT is naturally idempotent (re-granting is a no-op).
GRANT CONNECT ON DATABASE neondb TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Tenant", "User", "Membership", "Control", "Evidence", "Task"
TO app_runtime;

-- Enable RLS, and force it so it applies even to this table's owner
-- (neondb_owner) — see the BYPASSRLS caveat above for the one respect
-- in which that doesn't fully hold on this platform today. Both are
-- naturally idempotent (re-enabling/re-forcing is a no-op).
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Control" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Control" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;

-- One tenant per request is set via `SELECT set_config('app.tenant_id',
-- <uuid>, true)` inside a transaction (the `true` argument makes it
-- transaction-local, equivalent to SET LOCAL — see
-- src/common/tenant-transaction.middleware.ts). current_setting() with
-- no second argument throws if app.tenant_id was never set in the
-- current transaction, rather than silently returning NULL/no rows —
-- deliberately: every request that reaches these tables goes through
-- that middleware, so an unset app.tenant_id always means a real wiring
-- bug, and it should fail loudly rather than look like an empty table.
-- "tenantId" is stored as text (Prisma's `String @default(uuid())`,
-- not a native `uuid` column), so it's cast on both sides for a
-- type-safe comparison.
-- CREATE POLICY isn't idempotent, so DROP IF EXISTS first.
DROP POLICY IF EXISTS tenant_isolation ON "Membership";
CREATE POLICY tenant_isolation ON "Membership"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "Control";
CREATE POLICY tenant_isolation ON "Control"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "Evidence";
CREATE POLICY tenant_isolation ON "Evidence"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "Task";
CREATE POLICY tenant_isolation ON "Task"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);
