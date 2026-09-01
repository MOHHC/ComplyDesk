import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { cleanupTenant, createTenant, ownerClient, TenantFixture } from './helpers/fixtures';

describe('Workspace lookup (e2e)', () => {
  let app: INestApplication;
  let first: TenantFixture;
  let second: TenantFixture;
  const suffix = randomUUID().slice(0, 8);
  const secondSuffix = `${suffix}b`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    first = await createTenant(app.getHttpServer(), suffix);
    second = await createTenant(app.getHttpServer(), secondSuffix);
  }, 40000);

  afterAll(async () => {
    await cleanupTenant(first.tenantId);
    await cleanupTenant(second.tenantId);
    const owner = ownerClient();
    await owner.user.deleteMany({
      where: { email: { in: [`owner-${suffix}@example.com`, `owner-${secondSuffix}@example.com`] } },
    });
    await owner.$disconnect();
    await app.close();
  });

  it('returns the single workspace an email belongs to, with no tenant context at all', async () => {
    // No Host subdomain and no X-Tenant-Slug — exactly what the browser
    // sends from the root domain, where Membership's RLS policy has no
    // app.tenant_id to compare against. This works only because the
    // lookup goes through the SECURITY DEFINER helper.
    const res = await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', 'localhost:3001')
      .send({ email: `owner-${suffix}@example.com` })
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({ slug: first.slug, name: 'Phase 3 Test Co' });
  });

  it('returns every workspace when the user belongs to more than one', async () => {
    // Give the first owner a membership in the second tenant too.
    const owner = ownerClient();
    await owner.membership.create({
      data: { tenantId: second.tenantId, userId: first.ownerId, role: Role.ADMIN },
    });
    await owner.$disconnect();

    const res = await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', 'localhost:3001')
      .send({ email: `owner-${suffix}@example.com` })
      .expect(200);

    const slugs = res.body.map((w: { slug: string }) => w.slug).sort();
    expect(slugs).toEqual([first.slug, second.slug].sort());
  });

  it('matches regardless of the case the email is typed in', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', 'localhost:3001')
      .send({ email: `OWNER-${suffix}@EXAMPLE.com` })
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty list for an unknown email rather than an error', async () => {
    // Must not distinguish "no such account" from "account with no
    // workspaces" — the caller shows one message for both.
    const res = await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', 'localhost:3001')
      .send({ email: `nobody-${suffix}@example.com` })
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('rejects a malformed email before doing any lookup', async () => {
    await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', 'localhost:3001')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('never writes an audit row, even when a tenant happens to be resolved', async () => {
    // The endpoint is @SkipAudit: auditing it would persist the
    // looked-up email into whichever tenant's audit trail the caller
    // resolved, which is the PII the POST body exists to avoid logging.
    const owner = ownerClient();
    const before = await owner.auditEvent.count({ where: { tenantId: first.tenantId } });

    await request(app.getHttpServer())
      .post('/auth/workspaces')
      .set('Host', `${first.slug}.localhost`)
      .send({ email: `owner-${suffix}@example.com` })
      .expect(200);

    const after = await owner.auditEvent.count({ where: { tenantId: first.tenantId } });
    await owner.$disconnect();
    expect(after).toBe(before);
  });
});
