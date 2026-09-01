import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { addMember, cleanupTenant, createTenant, TenantFixture } from './helpers/fixtures';

describe('Evidence (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  let controlId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    fixture = await createTenant(app.getHttpServer(), suffix);
    const controls = await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    controlId = controls.body[0].id;
  }, 30000);

  afterAll(async () => {
    await cleanupTenant(fixture.tenantId);
    await app.close();
  });

  it('uploads a file to object storage, with a metadata row linking it to the control', async () => {
    const fileContent = `evidence content ${suffix}`;
    const res = await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .field('notes', 'quarterly review export')
      .attach('file', Buffer.from(fileContent), 'evidence.txt')
      .expect(201);

    expect(res.body.controlId).toBe(controlId);
    expect(res.body.fileName).toBe('evidence.txt');
    expect(res.body.fileSize).toBe(Buffer.byteLength(fileContent));
    expect(res.body.mimeType).toBe('text/plain');
    expect(res.body.fileKey).toContain(fixture.tenantId);

    // The control now has valid evidence.
    const controlRes = await request(app.getHttpServer())
      .get(`/controls/${controlId}`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    expect(controlRes.body.status).toBe('has_evidence');
  });

  it('lists evidence for a control with a working presigned download URL', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    const { downloadUrl } = listRes.body[0];
    expect(downloadUrl).toEqual(expect.any(String));

    // Prove the file actually landed in object storage — not just that
    // the metadata row and a plausible-looking URL exist.
    const downloadRes = await fetch(downloadUrl);
    expect(downloadRes.status).toBe(200);
    const body = await downloadRes.text();
    expect(body).toBe(`evidence content ${suffix}`);
  });

  it('rejects upload from an AUDITOR, a view-only role', async () => {
    const auditor = await addMember(fixture.tenantId, Role.AUDITOR, `${suffix}-ev`);

    await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${auditor.token}`)
      .attach('file', Buffer.from('x'), 'x.txt')
      .expect(403);
  });

  it('allows upload from a CONTRIBUTOR', async () => {
    const contributor = await addMember(fixture.tenantId, Role.CONTRIBUTOR, `${suffix}-ev2`);

    await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${contributor.token}`)
      .attach('file', Buffer.from('contributor upload'), 'c.txt')
      .expect(201);
  });

  it('404s uploading to a control that does not exist', async () => {
    await request(app.getHttpServer())
      .post(`/controls/${randomUUID()}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('x'), 'x.txt')
      .expect(404);
  });
});
