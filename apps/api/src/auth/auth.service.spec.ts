import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const buildService = () => {
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      tenant: { findUnique: jest.fn(), create: jest.fn() },
      membership: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((fn: any) => fn(prisma)),
    } as any;
    const jwt = {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as unknown as JwtService;
    return { service: new AuthService(prisma, jwt), prisma, jwt };
  };

  describe('signup', () => {
    it('creates a tenant, user, and OWNER membership, then returns a token', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: 'a@acme.com' });

      const result = await service.signup({
        email: 'a@acme.com',
        password: 'password123',
        name: 'Ada',
        tenantName: 'Acme Inc',
        tenantSlug: 'acme',
      } as any);

      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', userId: 'user-1', role: 'OWNER' },
      });
      // app.tenant_id must be set before the RLS-protected Membership
      // insert, since its WITH CHECK depends on it.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ accessToken: 'signed-token' });
    });

    it('rejects signup when the email is already registered', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.signup({ email: 'a@acme.com', tenantSlug: 'acme' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects signup when the tenant slug is already taken', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 'existing-tenant' });

      await expect(
        service.signup({ email: 'a@acme.com', tenantSlug: 'acme' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns a token when the password matches', async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
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

    it('rejects login when the password does not match', async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@acme.com',
        passwordHash,
      });

      await expect(
        service.login({ email: 'a@acme.com', password: 'wrong' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login when the user does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@acme.com', password: 'x' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
