import { ClsStore } from 'nestjs-cls';
import { Prisma, Role } from '@prisma/client';

export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  role?: Role;
  /** Set once per request by TenantMiddleware, from the Tenant row it
   * already looked up to resolve tenantId. DemoReadOnlyGuard reads this
   * to block mutating/AI-cost actions on the public demo tenant. */
  isDemoTenant?: boolean;
  /**
   * The Prisma transaction client for this request, with
   * app.tenant_id already set via SET LOCAL (see
   * tenant-transaction.middleware.ts). RLS-protected tables
   * (Membership, Control, Evidence, Task) must be queried through
   * this, not the plain PrismaService, or RLS silently hides
   * everything for the current transaction context.
   */
  tenantTx?: Prisma.TransactionClient;
}
