-- `prisma migrate dev` generated this against pre-existing, already-known
-- drift (a benign ivfflat-index "drop" Prisma can't express, plus FK
-- ON UPDATE churn from an unrelated schema/DB disagreement — see the
-- add_tenant_is_demo migration for the same note). Trimmed by hand down
-- to the real intent: the Invite table itself, RLS matching every other
-- tenant-owned table, and the one SECURITY DEFINER function the
-- pre-auth accept-invite flow needs.

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_tenantId_idx" ON "Invite"("tenantId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same RLS shape as every other tenant-owned table (see
-- add_rls_and_app_runtime_role): ENABLE + FORCE ROW LEVEL SECURITY, a
-- tenant_isolation policy comparing tenantId against app.tenant_id,
-- GRANT to app_runtime. This is what authenticated OWNER/ADMIN access
-- (creating and listing invites for their own workspace) goes through.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Invite" TO app_runtime;

ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Invite";
CREATE POLICY tenant_isolation ON "Invite"
  FOR ALL
  USING ("tenantId"::uuid = current_setting('app.tenant_id')::uuid)
  WITH CHECK ("tenantId"::uuid = current_setting('app.tenant_id')::uuid);

-- Redeeming an invite is structurally identical to signup's duplicate-
-- email check and the root-domain workspace picker: the caller has no
-- tenant context yet (that's the whole point — they're about to get one
-- from the code), so tenant_isolation's normal USING clause would throw
-- on current_setting('app.tenant_id') rather than returning a row. This
-- is the same SECURITY DEFINER shape as auth_email_exists and
-- auth_workspaces_for_email: as narrow as the job allows (returns only
-- what AuthService.acceptInvite needs to validate the code and know
-- which tenant/role to join — never the invite's id-adjacent internals
-- like who created it), SET search_path to close the search-path
-- injection hole SECURITY DEFINER opens, granted to app_runtime alone.
--
-- Deliberately does not check expiry or used-state itself — it returns
-- the row's actual state and lets the caller decide, so "this invite
-- already expired" and "this invite was already used" can be reported
-- as distinct, honest errors instead of both collapsing into "not
-- found".
CREATE OR REPLACE FUNCTION invite_lookup_by_code(p_code text)
  RETURNS TABLE (
    id text,
    tenant_id text,
    tenant_name text,
    tenant_slug text,
    role "Role",
    expires_at timestamp(3),
    used_at timestamp(3)
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT i.id, i."tenantId", t.name, t.slug, i.role, i."expiresAt", i."usedAt"
    FROM "Invite" i
    JOIN "Tenant" t ON t.id = i."tenantId"
    WHERE i.code = p_code
  $$;

REVOKE ALL ON FUNCTION invite_lookup_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_lookup_by_code(text) TO app_runtime;
