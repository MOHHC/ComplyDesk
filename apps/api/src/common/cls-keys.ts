import { ClsStore } from 'nestjs-cls';
import { Prisma, Role } from '@prisma/client';

export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  role?: Role;
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
