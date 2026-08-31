import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('signs up, logs in, and returns tenant context on /auth/me', async () => {
    const server = app.getHttpServer();

    const signupRes = await request(server)
      .post('/auth/signup')
      .set('Host', `${slug}.localhost`)
      .send({
        email,
        password: 'password123',
        name: 'Ada Lovelace',
        tenantName: 'E2E Tenant',
        tenantSlug: slug,
      })
      .expect(201);

    expect(signupRes.body.accessToken).toEqual(expect.any(String));

    const meRes = await request(server)
      .get('/auth/me')
      .set('Host', `${slug}.localhost`)
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .expect(200);

    expect(meRes.body.tenantId).toEqual(expect.any(String));
    expect(meRes.body.userId).toEqual(expect.any(String));
    expect(meRes.body.role).toBe('OWNER');

    const loginRes = await request(server)
      .post('/auth/login')
      .set('Host', `${slug}.localhost`)
      .send({ email, password: 'password123' })
      .expect(201);

    expect(loginRes.body.accessToken).toEqual(expect.any(String));
  }, 15000);

  it('rejects a valid token when the Host header resolves to no tenant', async () => {
    const server = app.getHttpServer();

    const signupRes = await request(server)
      .post('/auth/signup')
      .set('Host', `${slug}.localhost`)
      .send({
        email: `notenant-${email}`,
        password: 'password123',
        name: 'No Tenant Host',
        tenantName: 'No Tenant Host Co',
        tenantSlug: `notenant-${slug}`,
      })
      .expect(201);

    await request(server)
      .get('/auth/me')
      .set('Host', 'localhost')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .expect(403);

    await prisma.tenant.deleteMany({ where: { slug: `notenant-${slug}` } });
    await prisma.user.deleteMany({ where: { email: `notenant-${email}` } });
  });

  it('resolves the tenant via X-Tenant-Slug when the Host has no subdomain', async () => {
    const server = app.getHttpServer();
    const headerSlug = `header-${slug}`;
    const headerEmail = `header-${email}`;

    const signupRes = await request(server)
      .post('/auth/signup')
      .set('Host', `${headerSlug}.localhost`)
      .send({
        email: headerEmail,
        password: 'password123',
        name: 'Header Fallback',
        tenantName: 'Header Fallback Co',
        tenantSlug: headerSlug,
      })
      .expect(201);

    // No subdomain on Host here — this is exactly what the web app hits,
    // since browsers cannot override Host on fetch. X-Tenant-Slug is the
    // only way this request identifies its tenant.
    const meRes = await request(server)
      .get('/auth/me')
      .set('Host', 'localhost:3001')
      .set('X-Tenant-Slug', headerSlug)
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .expect(200);

    expect(meRes.body.tenantId).toEqual(expect.any(String));
    expect(meRes.body.role).toBe('OWNER');

    await prisma.tenant.deleteMany({ where: { slug: headerSlug } });
    await prisma.user.deleteMany({ where: { email: headerEmail } });
  }, 15000);

  it('rejects signup when the email is already registered', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/auth/signup')
      .set('Host', `${slug}.localhost`)
      .send({
        email,
        password: 'password123',
        name: 'Duplicate',
        tenantName: 'Duplicate Co',
        tenantSlug: `dup-${slug}`,
      })
      .expect(409);
  });
});
