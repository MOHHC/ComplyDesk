import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { cleanupTenant, createTenant, TenantFixture } from './helpers/fixtures';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  const suffix = randomUUID().slice(0, 8);

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

  it('reports 0% readiness and every control missing evidence on a fresh tenant', async () => {
    const controls = await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    const totalControls = controls.body.length;

    const res = await request(app.getHttpServer())
      .get('/dashboard/readiness')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(res.body).toEqual({
      totalControls,
      controlsWithValidEvidencePercent: 0,
      controlsMissingEvidence: totalControls,
      evidenceExpiringSoon: 0,
    });
  });

  it('recalculates after evidence is uploaded for one control', async () => {
    const controls = await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    const totalControls = controls.body.length;
    const controlId = controls.body[0].id;

    await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('dashboard evidence'), 'e.txt')
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/dashboard/readiness')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(res.body.controlsMissingEvidence).toBe(totalControls - 1);
    expect(res.body.controlsWithValidEvidencePercent).toBeCloseTo((1 / totalControls) * 100, 1);
  });
});
