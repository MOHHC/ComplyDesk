import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const buildService = () => {
    const tenantTx = {
      user: { findUnique: jest.fn() },
    };
    const prisma = {
      user: { findUnique: jest.fn() },
      tenant: { findUnique: jest.fn(), create: jest.fn() },
      membership: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ exists: false }]),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((fn: any) => fn(prisma)),
    } as any;
    const jwt = {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as unknown as JwtService;
    const store = new Map<string, unknown>([['tenantTx', tenantTx]]);
    const cls = {
      get: jest.fn((key: string) => store.get(key)),
      set: jest.fn((key: string, value: unknown) => store.set(key, value)),
    } as any;
    return { service: new AuthService(prisma, jwt, cls), prisma, jwt, cls, tenantTx, store };
  };

  describe('signup', () => {
    it('creates a tenant, user, and OWNER membership, then returns a token', async () => {
      const { service, prisma } = buildService();
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });

      const result = await service.signup({
        email: 'a@acme.com',
        password: 'password123',
        name: 'Ada',
        tenantName: 'Acme Inc',
        tenantSlug: 'acme',
      } as any);

      // The tenant's id is generated up front, not defaulted by Postgres,
      // because Tenant's INSERT policy checks the new row against
      // app.tenant_id — which therefore has to be set first.
      const createdTenant = prisma.tenant.create.mock.calls[0][0].data;
      expect(createdTenant.id).toEqual(expect.any(String));
      const contextCall = prisma.$executeRaw.mock.calls[0];
      expect(contextCall).toContain(createdTenant.id);

      const membership = prisma.membership.create.mock.calls[0][0].data;
      expect(membership.tenantId).toBe(createdTenant.id);
      expect(membership.role).toBe('OWNER');
      // The user row is inserted raw (no RETURNING) so the SELECT policy
      // can't reject it before its Membership exists.
      expect(prisma.user.create).toBeUndefined();
      expect(result).toEqual({ accessToken: 'signed-token' });
    });

    it('checks email uniqueness through the SECURITY DEFINER helper, not a direct read', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValue([{ exists: true }]);

      await expect(
        service.signup({ email: 'a@acme.com', tenantSlug: 'acme' } as any),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects signup when the tenant slug is already taken', async () => {
      const { service, prisma } = buildService();
      prisma.tenant.findUnique.mockResolvedValue({ id: 'existing-tenant' });

      await expect(
        service.signup({ email: 'a@acme.com', tenantSlug: 'acme' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a concurrent duplicate-email insert to a 409 rather than a 500', async () => {
      const { service, prisma } = buildService();
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'tenant-1' });
      // Both requests pass the advisory check; the unique index decides.
      prisma.$transaction.mockRejectedValue({ code: '23505' });

      await expect(
        service.signup({
          email: 'a@acme.com',
          password: 'p',
          name: 'A',
          tenantName: 'T',
          tenantSlug: 'acme',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns a token when the password matches', async () => {
      const { service, tenantTx } = buildService();
      const passwordHash = await bcrypt.hash('password123', 10);
      tenantTx.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@acme.com',
        passwordHash,
      });

      const result = await service.login({
        email: 'a@acme.com',
        password: 'password123',
      } as any);

      expect(result).toEqual({ accessToken: 'signed-token' });
    });

    it('looks the user up through the tenant transaction, so RLS scopes it to this workspace', async () => {
      const { service, tenantTx, prisma } = buildService();
      tenantTx.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'a@acme.com', password: 'x' } as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(tenantTx.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects login when no tenant was resolved for the request', async () => {
      const { service, store } = buildService();
      store.delete('tenantTx');

      await expect(
        service.login({ email: 'a@acme.com', password: 'x' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login when the password does not match', async () => {
      const { service, tenantTx } = buildService();
      const passwordHash = await bcrypt.hash('password123', 10);
      tenantTx.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@acme.com',
        passwordHash,
      });

      await expect(
        service.login({ email: 'a@acme.com', password: 'wrong' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login when the user does not exist', async () => {
      const { service, tenantTx } = buildService();
      tenantTx.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@acme.com', password: 'x' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
