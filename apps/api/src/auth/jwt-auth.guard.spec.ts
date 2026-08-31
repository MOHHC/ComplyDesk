import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const buildGuard = () => {
    const jwt = { verifyAsync: jest.fn() } as any;
    const prisma = { membership: { findUnique: jest.fn() } } as any;
    const store = new Map<string, unknown>();
    const cls = {
      get: jest.fn((key: string) => store.get(key)),
      set: jest.fn((key: string, value: unknown) => store.set(key, value)),
    } as any;
    return { guard: new JwtAuthGuard(jwt, prisma, cls), jwt, prisma, cls };
  };

  const contextWith = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it('rejects requests without a bearer token', async () => {
    const { guard } = buildGuard();
    await expect(guard.canActivate(contextWith({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid token', async () => {
    const { guard, jwt } = buildGuard();
    jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer bad' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when no tenant was resolved on the request', async () => {
    const { guard, jwt } = buildGuard();
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer good' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the user has no membership in the resolved tenant', async () => {
    const { guard, jwt, prisma, cls } = buildGuard();
    cls.set('tenantId', 'tenant-1');
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer good' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('stores userId and role in cls and allows the request through', async () => {
    const { guard, jwt, prisma, cls } = buildGuard();
    cls.set('tenantId', 'tenant-1');
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    prisma.membership.findUnique.mockResolvedValue({ role: 'OWNER' });

    const result = await guard.canActivate(
      contextWith({ authorization: 'Bearer good' }),
    );

    expect(result).toBe(true);
    expect(cls.set).toHaveBeenCalledWith('userId', 'user-1');
    expect(cls.set).toHaveBeenCalledWith('role', 'OWNER');
  });
});
