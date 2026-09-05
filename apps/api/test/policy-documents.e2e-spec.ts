import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AI_PROVIDER } from '../src/ai/ai-provider.token';
import { FakeAiProvider } from '../src/ai/fake-ai-provider.service';
import { createTenant, cleanupTenant, ownerClient, TenantFixture } from './helpers/fixtures';

describe('Policy documents (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER)
      .useClass(FakeAiProvider)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    fixture = await createTenant(app.getHttpServer(), suffix);
  }, 30000);

  afterAll(async () => {
    await cleanupTenant(fixture.tenantId);
    await app.close();
  });

  it('uploads a text policy document, chunks and embeds it, and marks it READY', async () => {
    const res = await request(app.getHttpServer())
      .post('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('Our access control policy requires quarterly reviews.'), 'policy.txt')
      .expect(201);

    expect(res.body.status).toBe('READY');

    const list = await request(app.getHttpServer())
      .get('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    expect(list.body.some((d: { id: string }) => d.id === res.body.id)).toBe(true);

    // Prove the chunk/embed loop actually ran and persisted rows, not
    // just that the document status flipped to READY.
    const owner = ownerClient();
    try {
      const chunkCount = await owner.policyChunk.count({ where: { documentId: res.body.id } });
      expect(chunkCount).toBeGreaterThan(0);
    } finally {
      await owner.$disconnect();
    }
  });

  it('rejects an unsupported file type', async () => {
    await request(app.getHttpServer())
      .post('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('not really docx'), 'policy.docx')
      .expect(400);
  });
});
