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
 */
export async function setTenantContext(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}
