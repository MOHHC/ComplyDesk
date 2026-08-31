import { Prisma } from '@prisma/client';

/**
 * Scopes a Prisma transaction to a tenant by setting the app.tenant_id
 * Postgres session variable the RLS policies check, via SET LOCAL
 * semantics (set_config's third argument) — never a plain SET, since a
 * plain SET's value persists on the underlying connection after the
 * transaction ends and would leak to whatever request borrows that
 * connection next from the pool. set_config's value is parameterized
 * (not string-interpolated), since SET LOCAL itself has no parameter
 * placeholder syntax in Postgres.
 *
 * Note for anyone editing the RLS policies: the `::uuid` cast in
 * `current_setting('app.tenant_id')::uuid` is load-bearing, not
 * cosmetic. On a *fresh* connection an unset app.tenant_id makes
 * current_setting() throw ("unrecognized configuration parameter"), but
 * on a *pooled* connection where an earlier transaction already set it,
 * the parameter still exists and current_setting() returns an empty
 * string instead of throwing. The cast is what turns that empty string
 * back into a loud error. Rewriting the policy as a plain text
 * comparison would silently turn "nobody set tenant context" into "this
 * tenant has no rows" — a wiring bug that looks like an empty table.
 * Both behaviours are verified in test/rls-isolation.e2e-spec.ts.
 */
export async function setTenantContext(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}
