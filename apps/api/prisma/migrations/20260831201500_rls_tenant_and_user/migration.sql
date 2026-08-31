-- RLS for the two tables the first RLS migration deliberately left out.
-- Both are architecturally different from Membership/Control/Evidence/Task:
-- Tenant *is* the tenant (no tenantId column to compare), and User is a
-- global identity whose tenant access is defined through Membership.
--
-- Every statement is idempotent, for the same reason as the first RLS
-- migration: CREATE ROLE is cluster-wide, so prisma's shadow-database
-- validation pass replays this file against a throwaway database before it
-- ever reaches the real target.

-- ---------------------------------------------------------------------
-- Tenant: policies split by command, not a single FOR ALL.
--
-- SELECT has to stay open because TenantMiddleware looks a tenant up by
-- slug *in order to establish* app.tenant_id — a single FOR ALL policy
-- referencing current_setting() would be a chicken-and-egg that makes
-- every request fail before it can resolve a tenant at all. The cost is
-- small and bounded: a Tenant row holds a name and a slug, and the slug
-- is already public because it is the hostname the request arrived on.
-- The protection that matters is on writes — nobody can rename or delete
-- a tenant that isn't theirs.
-- ---------------------------------------------------------------------
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_readable ON "Tenant";
CREATE POLICY tenant_readable ON "Tenant"
  FOR SELECT
  USING (true);

-- Signup creates a tenant before any tenant context could exist. It works
-- because AuthService.signup generates the tenant's uuid in application
-- code and calls setTenantContext() with it *before* the insert, so the
-- new row matches the context by construction. A row claiming any other
-- id is rejected.
DROP POLICY IF EXISTS tenant_self_insert ON "Tenant";
CREATE POLICY tenant_self_insert ON "Tenant"
  FOR INSERT
  WITH CHECK (id::uuid = current_setting('app.tenant_id')::uuid);

-- WITH CHECK as well as USING: without it an UPDATE could pass the USING
-- test on the old row and then rewrite id to point at another tenant.
DROP POLICY IF EXISTS tenant_self_update ON "Tenant";
CREATE POLICY tenant_self_update ON "Tenant"
  FOR UPDATE
  USING (id::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK (id::uuid = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_self_delete ON "Tenant";
CREATE POLICY tenant_self_delete ON "Tenant"
  FOR DELETE
  USING (id::uuid = current_setting('app.tenant_id')::uuid);

-- ---------------------------------------------------------------------
-- User: scoped through Membership rather than a tenantId column.
--
-- Reads are the realistic leak — a future endpoint listing users with no
-- tenant filter — and the SELECT policy closes them.
--
-- Writes get the same membership test, for a reason worth recording
-- because it is not the obvious one. Postgres applies SELECT policies to
-- an UPDATE or DELETE whenever the statement reads existing column values
-- — which any WHERE clause does — so the SELECT policy already blocks
-- every *qualified* cross-tenant write on its own. Measured on the test
-- branch: UPDATE ... WHERE id = <other tenant's user> affects 0 rows even
-- with a permissive USING (true) write policy. The gap is the fully
-- unqualified bulk write that reads nothing: UPDATE "User" SET name =
-- 'x' with no WHERE affected 2 rows across 2 tenants under USING (true),
-- and 1 row under the membership test below. So the membership test is
-- strictly better than USING (true) — it closes the bulk case and gives
-- up nothing, since the shared-user situation it is sometimes criticised
-- for (a person belonging to two tenants is writable by either) is
-- already how qualified writes behave via the SELECT policy.
--
-- INSERT is the exception and stays permissive: a user has no Membership
-- at the moment it is created, because Membership needs the id the insert
-- is producing. Nothing tenant-scoped is exposed by allowing the row in;
-- it is unreadable until its Membership exists.
--
-- Known and unfixable at this layer: User.email is globally unique, and
-- unique indexes are enforced beneath RLS. Inserting a duplicate email
-- raises a constraint violation whether or not the conflicting row is
-- visible, so email existence remains enumerable across tenants no matter
-- what these policies say. Closing that would require dropping the global
-- uniqueness of email, which is a schema decision, not an RLS one.
-- ---------------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_member_select ON "User";
CREATE POLICY user_member_select ON "User"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = "User".id
        AND m."tenantId"::uuid = current_setting('app.tenant_id')::uuid
    )
  );

-- RLS default-denies any command with no matching policy, so every
-- command the app uses needs one spelled out.
DROP POLICY IF EXISTS user_write_insert ON "User";
CREATE POLICY user_write_insert ON "User" FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS user_write_update ON "User";
CREATE POLICY user_write_update ON "User"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = "User".id
        AND m."tenantId"::uuid = current_setting('app.tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS user_write_delete ON "User";
CREATE POLICY user_write_delete ON "User"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = "User".id
        AND m."tenantId"::uuid = current_setting('app.tenant_id')::uuid
    )
  );

-- ---------------------------------------------------------------------
-- Signup's duplicate-email check is the one read that legitimately has to
-- see across every tenant, and it runs before any tenant exists, so there
-- is no context for the policy above to evaluate. A SECURITY DEFINER
-- function owned by the table owner is the narrow way to allow it: it
-- returns a single boolean rather than any row, so it grants exactly the
-- answer signup needs and nothing else.
--
-- This discloses whether an email is registered anywhere — but that is
-- already disclosed by the unique index (see above), so the function
-- widens nothing that wasn't observable already.
--
-- SET search_path is mandatory on SECURITY DEFINER: without it a caller
-- could put a malicious "User" table earlier on the path and have it read
-- under the owner's privileges.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_email_exists(p_email text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM "User" WHERE email = p_email) $$;

REVOKE ALL ON FUNCTION auth_email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_email_exists(text) TO app_runtime;
