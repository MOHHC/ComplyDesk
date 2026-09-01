-- Backs the root-domain workspace picker: given an email, which tenants
-- does that user belong to?
--
-- This has to be SECURITY DEFINER for the same structural reason
-- auth_email_exists is. The lookup runs at the root domain (no
-- subdomain), so no tenant is resolved, so there is no
-- app.tenant_id — and Membership's tenant_isolation policy compares
-- against exactly that. A normal query here doesn't return zero rows, it
-- throws. It also legitimately needs to see *across* tenants, which is
-- the one thing the tenant_isolation policy exists to prevent, so no
-- amount of tenant context would make a normal query correct either.
--
-- Kept as narrow as the job allows: takes one email, returns only slug
-- and name (never user ids, roles, or membership counts), and is granted
-- to app_runtime alone rather than PUBLIC. SET search_path is mandatory
-- on SECURITY DEFINER — without it a caller could put a malicious
-- "Membership" table earlier on the path and have it read with the
-- owner's privileges.
--
-- Privacy note, deliberate and worth stating: this is an unauthenticated
-- enumeration oracle. It discloses that an email is registered and which
-- organizations that person belongs to. The mature fix is to email the
-- workspace list rather than return it (what Slack and Notion do), which
-- needs email infrastructure this project doesn't have yet. Until then
-- the endpoint in front of this is rate limited per IP, and the exposure
-- is capped at slug + display name.
--
-- lower(p_email) mirrors the lowercase-email invariant enforced by
-- SignupDto/LoginDto and the User_email_lowercase_check constraint, so a
-- caller passing mixed case still matches.
CREATE OR REPLACE FUNCTION auth_workspaces_for_email(p_email text)
  RETURNS TABLE (slug text, name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.slug, t.name
    FROM "User" u
    JOIN "Membership" m ON m."userId" = u.id
    JOIN "Tenant" t ON t.id = m."tenantId"
    WHERE u.email = lower(p_email)
    ORDER BY t.name, t.slug
  $$;

REVOKE ALL ON FUNCTION auth_workspaces_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_workspaces_for_email(text) TO app_runtime;
