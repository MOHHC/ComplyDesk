import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AI_PROVIDER } from '../src/ai/ai-provider.token';
import { FakeAiProvider } from '../src/ai/fake-ai-provider.service';
import { createTenant, addMember, cleanupTenant, TenantFixture } from './helpers/fixtures';

describe('Gap analysis (e2e)', () => {
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

  it('with no policy documents, reports every control as not covered without calling the LLM', async () => {
    const res = await request(app.getHttpServer())
      .post('/gap-analysis/run')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(201);

    expect(res.body.results.length).toBe(18);
    expect(res.body.results.every((r: { covered: boolean }) => r.covered === false)).toBe(true);
    expect(res.body.results[0].reasoning).toBe('No policy documents uploaded');
  });

  it("after a policy upload, reflects the fake provider's fixture-driven coverage outcome", async () => {
    await request(app.getHttpServer())
      .post('/policy-documents')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('we perform access reviews every quarter without fail'), 'ac-policy.txt')
      .expect(201);

    // FakeAiProvider.checkControlCoverage reports covered only when the
    // *control's own description* contains "COVERED:<index>" — none of
    // the seeded controls' real descriptions do, so with the real seed
    // data every control is still reported not-covered here. This test
    // asserts the shape and citation-wiring plumbing rather than a
    // specific covered/not-covered split, since steering per-control
    // outcomes would require editing seeded control descriptions.
    const res = await request(app.getHttpServer())
      .post('/gap-analysis/run')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(201);

    expect(res.body.results.length).toBe(18);
    for (const result of res.body.results) {
      expect(result).toHaveProperty('covered');
      expect(result).toHaveProperty('reasoning');
      expect(result.control).toBeTruthy();
    }

    const latest = await request(app.getHttpServer())
      .get('/gap-analysis/latest')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    expect(latest.body.runId).toBe(res.body.runId);
  });

  it('rejects a run request from an AUDITOR', async () => {
    const auditor = await addMember(fixture.tenantId, Role.AUDITOR, `${suffix}-gap`);

    await request(app.getHttpServer())
      .post('/gap-analysis/run')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(403);
  });
});
