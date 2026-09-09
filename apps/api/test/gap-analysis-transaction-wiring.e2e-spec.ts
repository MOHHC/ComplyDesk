import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AI_PROVIDER } from '../src/ai/ai-provider.token';
import { FakeAiProvider } from '../src/ai/fake-ai-provider.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenant, cleanupTenant, TenantFixture } from './helpers/fixtures';

/**
 * Covers the AppModule.configure() wiring added to fix Task 12's review
 * finding: POST /gap-analysis/run must open its tenant transaction with
 * the longer GapAnalysisTransactionMiddleware timeout, and every other
 * route must be unaffected (still the plain 15s/10s
 * TenantTransactionMiddleware default). A typecheck can't catch a
 * misrouted `.exclude()`/`.forRoutes()` call — this spies on
 * PrismaService.$transaction (through the real AppModule wiring, real
 * middleware stack, real DB) and asserts which options object each
 * route's request actually opened its transaction with.
 *
 * Extended to cover the same wiring for POST /policy-documents (fix-wave
 * finding 6): that route also needs a longer timeout than the 15s/10s
 * default, via its own PolicyDocumentsTransactionMiddleware.
 */
describe('Gap analysis transaction-timeout wiring (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  let transactionSpy: jest.SpyInstance;
  let controlId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER)
      .useClass(FakeAiProvider)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const prisma = app.get(PrismaService);
    transactionSpy = jest.spyOn(prisma, '$transaction');

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

  beforeEach(() => {
    transactionSpy.mockClear();
  });

  it('opens an ordinary route\'s transaction with the unchanged 15s/10s default', async () => {
    await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    // TenantMiddleware must have run first (it's what resolves tenantId,
    // without which TenantTransactionMiddleware skips opening a
    // transaction at all — the request succeeding at all is only
    // possible if the ordering held), and exactly one transaction
    // middleware must have run for this route.
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 15000, maxWait: 10000 });
  });

  it('opens POST /gap-analysis/run\'s transaction with the longer gap-analysis timeout', async () => {
    await request(app.getHttpServer())
      .post('/gap-analysis/run')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(201);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 90000, maxWait: 10000 });
  });

  it('still opens GET /gap-analysis/latest\'s transaction with the unchanged default (only the run route is excluded)', async () => {
    await request(app.getHttpServer())
      .get('/gap-analysis/latest')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 15000, maxWait: 10000 });
  });

  it('opens POST /policy-documents\'s transaction with the longer policy-documents timeout', async () => {
    await request(app.getHttpServer())
      .post('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('wiring test policy content'), 'wiring.txt')
      .expect(201);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 120000, maxWait: 10000 });
  });

  it('still opens GET /policy-documents\'s transaction with the unchanged default (only the upload route is excluded)', async () => {
    await request(app.getHttpServer())
      .get('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 15000, maxWait: 10000 });
  });

  // Added investigating a real bug: a real image evidence upload came
  // back with classification: null because GeminiAiProvider's image
  // classification timeout (never separately measured from text) was
  // silently too short. The fix needed EvidenceTransactionMiddleware's
  // own timeout raised to match — this pair of cases is this file's
  // existing wiring-assertion pattern, applied to the one route it
  // didn't cover yet.
  it("opens POST .../evidence's transaction with the longer evidence-upload timeout", async () => {
    await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('wiring test evidence content'), 'wiring.txt')
      .expect(201);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 110000, maxWait: 10000 });
  });

  it("still opens GET .../evidence's transaction with the unchanged default (only the upload route is excluded)", async () => {
    await request(app.getHttpServer())
      .get(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0][1]).toEqual({ timeout: 15000, maxWait: 10000 });
  });
});
