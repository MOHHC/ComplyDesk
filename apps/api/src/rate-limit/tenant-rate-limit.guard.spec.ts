import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { TenantRateLimitGuard } from './tenant-rate-limit.guard';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

function fakeContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('TenantRateLimitGuard', () => {
  function buildGuard(rateLimitName: string | undefined, tenantId: string | undefined) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(rateLimitName) } as unknown as Reflector;
    const cls = { get: jest.fn().mockReturnValue(tenantId) } as unknown as ClsService<any>;
    return new TenantRateLimitGuard(reflector, cls);
  }

  it('allows requests through when the route has no @RateLimit()', () => {
    const guard = buildGuard(undefined, 'tenant-1');
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('allows requests under the configured limit and blocks the one that exceeds it', () => {
    const guard = buildGuard('gapAnalysis', 'tenant-1'); // limit: 5/hour
    for (let i = 0; i < 5; i += 1) {
      expect(guard.canActivate(fakeContext())).toBe(true);
    }
    expect(() => guard.canActivate(fakeContext())).toThrow(/Too many/);
  });

  it('tracks separate windows per tenant', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('gapAnalysis') } as unknown as Reflector;
    let currentTenant = 'tenant-a';
    const cls = { get: jest.fn(() => currentTenant) } as unknown as ClsService<any>;
    const guard = new TenantRateLimitGuard(reflector, cls);

    for (let i = 0; i < 5; i += 1) guard.canActivate(fakeContext());
    expect(() => guard.canActivate(fakeContext())).toThrow(/Too many/);

    currentTenant = 'tenant-b';
    expect(guard.canActivate(fakeContext())).toBe(true); // fresh window for a different tenant
  });
});
