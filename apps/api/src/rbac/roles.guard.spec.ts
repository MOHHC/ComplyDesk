import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const buildContext = () =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  const buildGuard = (requiredRoles: Role[] | undefined, currentRole: Role | undefined) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    const cls = { get: jest.fn().mockReturnValue(currentRole) } as any;
    return new RolesGuard(reflector, cls);
  };

  it('allows any authenticated role through when no @Roles() is set', () => {
    const guard = buildGuard(undefined, Role.AUDITOR);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('allows a role that is in the required list', () => {
    const guard = buildGuard([Role.OWNER, Role.ADMIN], Role.ADMIN);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('rejects a role that is not in the required list', () => {
    const guard = buildGuard([Role.OWNER, Role.ADMIN], Role.CONTRIBUTOR);
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it('rejects when no role was resolved at all', () => {
    const guard = buildGuard([Role.OWNER], undefined);
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });
});
