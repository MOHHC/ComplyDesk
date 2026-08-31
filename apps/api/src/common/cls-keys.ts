import { ClsStore } from 'nestjs-cls';
import { Role } from '@prisma/client';

export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  role?: Role;
}
