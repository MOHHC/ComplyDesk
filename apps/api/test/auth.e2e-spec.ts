import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`;

  /**
   * Fixture teardown runs as the owner, not through the app's
   * PrismaService. Deleting a Tenant is now RLS-scoped to
   * current_setting('app.tenant_id'), which only exists inside a request's
   * tenant transaction — so cleanup from outside a request has no context
   * to run under. That's the policy working, not a problem to route
   * around in application code.
   */
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await owner.tenant.deleteMany({ where: { slug } });
    await owner.user.deleteMany({ where: { email } });
    await owner.$disconnect();
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
  });

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

    await owner.tenant.deleteMany({ where: { slug: `notenant-${slug}` } });
    await owner.user.deleteMany({ where: { email: `notenant-${email}` } });
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

    await owner.tenant.deleteMany({ where: { slug: headerSlug } });
    await owner.user.deleteMany({ where: { email: headerEmail } });
  });

  it('refuses login from a workspace the user has no membership in', async () => {
    const server = app.getHttpServer();
    const otherSlug = `other-${slug}`;

    // A second, unrelated workspace. The user created in the first test
    // belongs to `slug`, not to this one.
    await request(server)
      .post('/auth/signup')
      .set('Host', `${otherSlug}.localhost`)
      .send({
        email: `other-${email}`,
        password: 'password123',
        name: 'Other Workspace',
        tenantName: 'Other Workspace Co',
        tenantSlug: otherSlug,
      })
      .expect(201);

    // Correct credentials, wrong workspace. RLS scopes the lookup through
    // Membership, so the user simply isn't found here — the API no longer
    // mints a token and leaves /auth/me to reject it afterwards.
    await request(server)
      .post('/auth/login')
      .set('Host', `${otherSlug}.localhost`)
      .send({ email, password: 'password123' })
      .expect(401);

    // Same credentials on the right workspace still work.
    await request(server)
      .post('/auth/login')
      .set('Host', `${slug}.localhost`)
      .send({ email, password: 'password123' })
      .expect(201);

    await owner.tenant.deleteMany({ where: { slug: otherSlug } });
    await owner.user.deleteMany({ where: { email: `other-${email}` } });
  });

  it('logs in with a different email case than was used at signup', async () => {
    // Regression test: signup stored the email exactly as typed
    // ("Case-...@example.com") with no normalization anywhere, and
    // Postgres text equality is case-sensitive, so a login attempt with
    // different casing (e.g. a mobile keyboard autocapitalizing one field
    // and not the other) found zero rows and failed with the same
    // generic "Invalid email or password" as a wrong password — a real
    // signup-then-login failure that looked like a bcrypt bug but was
    // actually the lookup itself never finding the row.
    const server = app.getHttpServer();
    const caseSlug = `case-${slug}`;
    const mixedCaseEmail = `Case-${email}`;

    await request(server)
      .post('/auth/signup')
      .set('Host', `${caseSlug}.localhost`)
      .send({
        email: mixedCaseEmail,
        password: 'password123',
        name: 'Case Sensitivity',
        tenantName: 'Case Sensitivity Co',
        tenantSlug: caseSlug,
      })
      .expect(201);

    const loginRes = await request(server)
      .post('/auth/login')
      .set('Host', `${caseSlug}.localhost`)
      .send({ email: mixedCaseEmail.toLowerCase(), password: 'password123' })
      .expect(201);

    expect(loginRes.body.accessToken).toEqual(expect.any(String));

    // The duplicate-email check at signup must catch the same email in
    // a different case too, not just an exact string match.
    await request(server)
      .post('/auth/signup')
      .set('Host', `${caseSlug}.localhost`)
      .send({
        email: mixedCaseEmail.toUpperCase(),
        password: 'password123',
        name: 'Duplicate Case',
        tenantName: 'Duplicate Case Co',
        tenantSlug: `dup-${caseSlug}`,
      })
      .expect(409);

    const stored = await owner.user.findUnique({
      where: { email: mixedCaseEmail.toLowerCase() },
    });
    expect(stored?.email).toBe(mixedCaseEmail.toLowerCase());

    await owner.tenant.deleteMany({ where: { slug: caseSlug } });
    await owner.user.deleteMany({ where: { email: mixedCaseEmail.toLowerCase() } });
  });

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
