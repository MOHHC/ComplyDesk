import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
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
      invite: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      control: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
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
    const seedControls = {
      getControls: jest.fn().mockReturnValue([
        {
          code: 'AC-01',
          category: 'Access Control',
          title: 'Seed Control',
          description: 'd',
          evidence_guidance: 'g',
          refresh_interval_days: 90,
        },
      ]),
    } as any;
    return {
      service: new AuthService(prisma, jwt, cls, seedControls),
      prisma,
      jwt,
      cls,
      tenantTx,
      store,
      seedControls,
    };
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
      // Returns the tenant it created, not just a token: the web client
      // builds its post-signup redirect from this slug rather than from
      // its own form state, so the server's answer has to be present and
      // authoritative.
      expect(result).toEqual({
        accessToken: 'signed-token',
        tenantId: createdTenant.id,
        tenantSlug: 'acme',
      });
    });

    it('seeds the tenant with every control from SeedControlsService', async () => {
      const { service, prisma } = buildService();
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'tenant-1' });

      await service.signup({
        email: 'a@acme.com',
        password: 'password123',
        name: 'Ada',
        tenantName: 'Acme Inc',
        tenantSlug: 'acme',
      } as any);

      const createdTenant = prisma.tenant.create.mock.calls[0][0].data;
      const seeded = prisma.control.createMany.mock.calls[0][0].data;
      expect(seeded).toHaveLength(1);
      expect(seeded[0]).toMatchObject({
        tenantId: createdTenant.id,
        code: 'AC-01',
        category: 'Access Control',
        evidenceGuidance: 'g',
        refreshIntervalDays: 90,
      });
    });

    it('writes its own audit.signup event, since the generic interceptor has no tenant context to use yet', async () => {
      const { service, prisma } = buildService();
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 'tenant-1' });

      await service.signup({
        email: 'a@acme.com',
        password: 'password123',
        name: 'Ada',
        tenantName: 'Acme Inc',
        tenantSlug: 'acme',
      } as any);

      const createdTenant = prisma.tenant.create.mock.calls[0][0].data;
      const auditData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(auditData).toMatchObject({
        tenantId: createdTenant.id,
        action: 'auth.signup',
        targetType: 'Tenant',
        targetId: createdTenant.id,
        statusCode: 201,
      });
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

    it('records the logged-in user in cls, since login never runs through JwtAuthGuard', async () => {
      const { service, tenantTx, cls } = buildService();
      const passwordHash = await bcrypt.hash('password123', 10);
      tenantTx.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@acme.com',
        passwordHash,
      });

      await service.login({ email: 'a@acme.com', password: 'password123' } as any);

      expect(cls.set).toHaveBeenCalledWith('userId', 'user-1');
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

  // invite_lookup_by_code()'s row shape — see the add_invites migration.
  const validInviteRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'invite-1',
    tenant_id: 'tenant-1',
    tenant_name: 'Acme Inc',
    tenant_slug: 'acme',
    role: Role.CONTRIBUTOR,
    expires_at: new Date(Date.now() + 60_000),
    used_at: null,
    ...overrides,
  });

  describe('getInviteInfo', () => {
    it('reports a live invite as valid', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValue([validInviteRow()]);

      const result = await service.getInviteInfo('code-1');

      expect(result).toEqual({
        tenantName: 'Acme Inc',
        tenantSlug: 'acme',
        role: Role.CONTRIBUTOR,
        valid: true,
        expired: false,
        used: false,
      });
    });

    it('reports why an expired invite is invalid, distinctly from a used one', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValue([validInviteRow({ expires_at: new Date(Date.now() - 1000) })]);

      const result = await service.getInviteInfo('code-1');

      expect(result).toMatchObject({ valid: false, expired: true, used: false });
    });

    it('reports a redeemed invite as used, not expired', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValue([validInviteRow({ used_at: new Date() })]);

      const result = await service.getInviteInfo('code-1');

      expect(result).toMatchObject({ valid: false, expired: false, used: true });
    });

    it('throws NotFoundException for a code that matches no invite', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getInviteInfo('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptInvite', () => {
    const dto = { code: 'code-1', email: 'new@acme.com', password: 'password123', name: 'New Person' } as any;

    it('joins the invite\'s tenant with the invite\'s role, and marks the invite used', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw
        .mockResolvedValueOnce([validInviteRow()]) // invite_lookup_by_code
        .mockResolvedValueOnce([{ exists: false }]); // auth_email_exists

      const result = await service.acceptInvite(dto);

      const contextCall = prisma.$executeRaw.mock.calls[0];
      expect(contextCall).toContain('tenant-1');
      const membership = prisma.membership.create.mock.calls[0][0].data;
      expect(membership).toEqual({ tenantId: 'tenant-1', userId: expect.any(String), role: Role.CONTRIBUTOR });
      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', usedAt: null },
        data: { usedAt: expect.any(Date), usedById: expect.any(String) },
      });
      expect(result).toEqual({ accessToken: 'signed-token', tenantId: 'tenant-1', tenantSlug: 'acme' });
    });

    it('writes its own audit event, the same as signup', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow()]).mockResolvedValueOnce([{ exists: false }]);

      await service.acceptInvite(dto);

      expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({
        tenantId: 'tenant-1',
        action: 'auth.acceptInvite',
        targetType: 'Invite',
        targetId: 'invite-1',
        statusCode: 201,
      });
    });

    it('rejects an unknown invite code', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.acceptInvite(dto)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an already-used invite before ever opening a transaction', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow({ used_at: new Date() })]);

      await expect(service.acceptInvite(dto)).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired invite', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow({ expires_at: new Date(Date.now() - 1000) })]);

      await expect(service.acceptInvite(dto)).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when the email is already registered', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow()]).mockResolvedValueOnce([{ exists: true }]);

      await expect(service.acceptInvite(dto)).rejects.toThrow(ConflictException);
    });

    it('rolls back and rejects when two requests redeem the same code concurrently', async () => {
      // Both requests pass the advisory used_at check above; the
      // conditional update inside the transaction is what actually
      // decides — see acceptInvite's own comment on why.
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow()]).mockResolvedValueOnce([{ exists: false }]);
      prisma.invite.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvite(dto)).rejects.toThrow(ConflictException);
    });

    it('maps a concurrent duplicate-email insert to a 409 rather than a 500', async () => {
      const { service, prisma } = buildService();
      prisma.$queryRaw.mockResolvedValueOnce([validInviteRow()]).mockResolvedValueOnce([{ exists: false }]);
      prisma.$transaction.mockRejectedValue({ code: '23505' });

      await expect(service.acceptInvite(dto)).rejects.toThrow(ConflictException);
    });
  });
});
