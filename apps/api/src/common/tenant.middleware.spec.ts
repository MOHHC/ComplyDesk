import { TenantMiddleware } from './tenant.middleware';

describe('TenantMiddleware', () => {
  const buildDeps = () => ({
    prisma: { tenant: { findUnique: jest.fn() } } as any,
    cls: { set: jest.fn() } as any,
  });

  it('resolves the tenant from the host subdomain and stores its id in cls', async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'acme.localhost:3000' } } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
    });
    expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next without setting a tenant when the host has no subdomain and no header is present', async () => {
    const { prisma, cls } = buildDeps();
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'localhost:3000' } } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(cls.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next without setting a tenant when the subdomain matches no tenant', async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue(null);
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'ghost.localhost:3000' } } as any,
      {} as any,
      next,
    );

    expect(cls.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to the X-Tenant-Slug header when the host has no subdomain', async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'localhost:3001', 'x-tenant-slug': 'acme' } } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
    });
    expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('prefers the host subdomain over the X-Tenant-Slug header when both are present', async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-host', slug: 'fromhost' });
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      {
        headers: { host: 'fromhost.localhost:3000', 'x-tenant-slug': 'fromheader' },
      } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'fromhost' },
    });
    expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-host');
  });

  it('lowercases the X-Tenant-Slug header before lookup', async () => {
    const { prisma, cls } = buildDeps();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'localhost:3001', 'x-tenant-slug': 'ACME' } } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
    });
  });

  it('ignores an array-valued X-Tenant-Slug header safely', async () => {
    const { prisma, cls } = buildDeps();
    const middleware = new TenantMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use(
      { headers: { host: 'localhost:3001', 'x-tenant-slug': ['a', 'b'] } } as any,
      {} as any,
      next,
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'a' } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('WEB_ORIGIN-scoped host trust (production)', () => {
    const originalWebOrigin = process.env.WEB_ORIGIN;

    beforeEach(() => {
      process.env.WEB_ORIGIN = 'https://complydesk.online';
    });

    afterEach(() => {
      process.env.WEB_ORIGIN = originalWebOrigin;
    });

    it('resolves the tenant from a real subdomain of WEB_ORIGIN', async () => {
      const { prisma, cls } = buildDeps();
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
      const middleware = new TenantMiddleware(prisma, cls);
      const next = jest.fn();

      await middleware.use({ headers: { host: 'acme.complydesk.online' } } as any, {} as any, next);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'acme' } });
      expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
    });

    // The actual production bug, reproduced: the API's own deployed
    // hostname (e.g. Render's complydesk-api.onrender.com) has the same
    // three-label shape as a real tenant subdomain, so parseSubdomain
    // alone would misread it as slug "complydesk-api" and never fall
    // through to the header the web app is actually sending. Trusting
    // Host resolution only within WEB_ORIGIN's domain is what fixes it.
    it('falls through to X-Tenant-Slug when Host is a hosting platform domain, not WEB_ORIGIN', async () => {
      const { prisma, cls } = buildDeps();
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
      const middleware = new TenantMiddleware(prisma, cls);
      const next = jest.fn();

      await middleware.use(
        { headers: { host: 'complydesk-api.onrender.com', 'x-tenant-slug': 'acme' } } as any,
        {} as any,
        next,
      );

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'acme' } });
      expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
    });

    it('still resolves *.localhost hosts even when WEB_ORIGIN is a production domain', async () => {
      const { prisma, cls } = buildDeps();
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', slug: 'acme' });
      const middleware = new TenantMiddleware(prisma, cls);
      const next = jest.fn();

      await middleware.use({ headers: { host: 'acme.localhost:3000' } } as any, {} as any, next);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'acme' } });
      expect(cls.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
    });
  });
});
