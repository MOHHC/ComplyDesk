import { ForbiddenException } from '@nestjs/common';
import { DemoReadOnlyGuard } from './demo-tenant.guard';

describe('DemoReadOnlyGuard', () => {
  const buildGuard = (isDemoTenant: boolean | undefined) => {
    const cls = { get: jest.fn().mockReturnValue(isDemoTenant) } as any;
    return new DemoReadOnlyGuard(cls);
  };

  it('allows the request through for an ordinary tenant', () => {
    const guard = buildGuard(false);
    expect(guard.canActivate({} as any)).toBe(true);
  });

  it('allows the request through when no tenant context was resolved at all', () => {
    // Mirrors TenantRateLimitGuard's own stance: absence of tenant
    // context isn't this guard's problem to enforce — RLS/JwtAuthGuard
    // already cover that case upstream.
    const guard = buildGuard(undefined);
    expect(guard.canActivate({} as any)).toBe(true);
  });

  it('rejects with ForbiddenException on the demo tenant', () => {
    const guard = buildGuard(true);
    expect(() => guard.canActivate({} as any)).toThrow(ForbiddenException);
  });
});
