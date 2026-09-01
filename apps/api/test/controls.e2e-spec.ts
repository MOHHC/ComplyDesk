import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { addMember, cleanupTenant, createTenant, TenantFixture } from './helpers/fixtures';

describe('Controls (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  const suffix = randomUUID().slice(0, 8);

  const seedControls = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'seeds', 'controls.json'), 'utf8'),
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    fixture = await createTenant(app.getHttpServer(), suffix);
  }, 30000);

  afterAll(async () => {
    await cleanupTenant(fixture.tenantId);
    await app.close();
  });

  it('seeds exactly the controls from seeds/controls.json on signup', async () => {
    const res = await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(res.body).toHaveLength(seedControls.length);
    const codes = res.body.map((c: { code: string }) => c.code).sort();
    expect(codes).toEqual(seedControls.map((c: { code: string }) => c.code).sort());
    // Every control starts with no evidence.
    expect(res.body.every((c: { status: string }) => c.status === 'no_evidence')).toBe(true);
  }, 15000);

  it('filters by category', async () => {
    const res = await request(app.getHttpServer())
      .get('/controls?category=Access Control')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    const expectedCount = seedControls.filter(
      (c: { category: string }) => c.category === 'Access Control',
    ).length;
    expect(res.body).toHaveLength(expectedCount);
    expect(res.body.every((c: { category: string }) => c.category === 'Access Control')).toBe(
      true,
    );
  });

  it('filters by status', async () => {
    const res = await request(app.getHttpServer())
      .get('/controls?status=has_evidence')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    // Fresh tenant, no evidence uploaded anywhere yet.
    expect(res.body).toHaveLength(0);
  });

  it('is viewable by an AUDITOR, a view-only role', async () => {
    const auditor = await addMember(fixture.tenantId, Role.AUDITOR, `${suffix}-view`);

    await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(200);
  });
});
