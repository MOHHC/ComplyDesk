import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles. Requires JwtAuthGuard to have run
 * first (RolesGuard reads the role JwtAuthGuard already resolved and
 * stored in cls) — always pair as `@UseGuards(JwtAuthGuard, RolesGuard)`,
 * in that order.
 *
 * A route with no @Roles() is reachable by any authenticated member,
 * regardless of role — i.e. JwtAuthGuard's membership check is the only
 * gate. Use that for plain "view" endpoints.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
