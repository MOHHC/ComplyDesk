import { Role } from '@prisma/client';
import { InvitesService } from './invites.service';

describe('InvitesService', () => {
  const buildService = () => {
    const tenantTx = {
      invite: { create: jest.fn(), findMany: jest.fn() },
    };
    const prisma = {} as any;
    const store = new Map<string, unknown>([
      ['tenantTx', tenantTx],
      ['tenantId', 'tenant-1'],
      ['userId', 'user-1'],
    ]);
    const cls = { get: jest.fn((key: string) => store.get(key)) } as any;
    return { service: new InvitesService(prisma, cls), tenantTx };
  };

  it('creates an invite with a random code, the given role, and a future expiry', async () => {
    const { service, tenantTx } = buildService();
    tenantTx.invite.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'invite-1', ...data }));

    const before = Date.now();
    const result = await service.create(Role.ADMIN);

    expect(tenantTx.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          createdById: 'user-1',
          role: Role.ADMIN,
        }),
      }),
    );
    expect(result.code).toMatch(/^[A-Za-z0-9_-]{40,}$/); // 32 random bytes, base64url
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('generates a different code on every call', async () => {
    const { service, tenantTx } = buildService();
    tenantTx.invite.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'x', ...data }));

    const a = await service.create(Role.CONTRIBUTOR);
    const b = await service.create(Role.CONTRIBUTOR);

    expect(a.code).not.toEqual(b.code);
  });

  it('listPending filters to unused, unexpired invites', async () => {
    const { service, tenantTx } = buildService();
    tenantTx.invite.findMany.mockResolvedValue([]);

    await service.listPending();

    expect(tenantTx.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usedAt: null, expiresAt: { gt: expect.any(Date) } },
      }),
    );
  });
});
