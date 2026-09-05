import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AI_PROVIDER } from '../src/ai/ai-provider.token';
import { FakeAiProvider } from '../src/ai/fake-ai-provider.service';
import { createTenant, cleanupTenant, TenantFixture } from './helpers/fixtures';

describe('Tenant rate limiting (e2e)', () => {
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

  // This tenant never uploads a policy document, so every run below takes
  // GapAnalysisService.run()'s chunkCount === 0 branch -- 18 controls, no
  // embed/coverage calls to the (fake) AI provider, DB writes only. Task 13
  // measured that exact branch at ~7.2-7.8s/run against the real Neon test
  // branch; the "with policy upload" branch (which does call the AI
  // provider per control) ran ~18-28s/run, but that branch is NOT what this
  // test exercises since no policy document is ever attached here. Budget:
  // 5 runs x ~8s + a fast 6th (rejected by the guard before the controller
  // method runs, same shape as the AUDITOR-403 case measured at ~2-2.5s) =
  // roughly 40-45s of real work; 90s leaves ~2x headroom for Neon
  // variance/cold starts, consistent with this repo's pattern of budgeting
  // well above the measured figure (see gap-analysis.e2e-spec.ts's 60000ms
  // test for a ~27s measured call).
  it('rejects the 6th gap-analysis run within an hour for the same tenant', async () => {
    const runIds = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/gap-analysis/run')
        .set('Host', `${fixture.slug}.localhost`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .expect(201);

      // Each of the 5 must be a genuine, complete gap-analysis run --
      // not merely a 201 with an empty/malformed body -- so that the 6th
      // request's 429 actually demonstrates "5 real runs used up the
      // budget" rather than being reachable some other way (e.g. a
      // request counter that increments even on a failed/short-circuited
      // run).
      expect(res.body.results.length).toBe(18);
      expect(res.body.runId).toBeTruthy();
      runIds.add(res.body.runId);
    }

    // Five distinct run rows really were created (as opposed to, say, a
    // cached/duplicate response satisfying .expect(201) five times).
    expect(runIds.size).toBe(5);

    const rejected = await request(app.getHttpServer())
      .post('/gap-analysis/run')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(429);

    // Assert on the limiter's own identifying message, not just the bare
    // 429 status -- a bare status code would also pass if some unrelated
    // middleware (a proxy, a global throttle, a body-size guard) happened
    // to reject the 6th call for a different reason. TenantRateLimitGuard
    // is the only thing in this stack that produces this exact wording,
    // naming the specific limit ("gapAnalysis") it enforced.
    expect(rejected.body.statusCode).toBe(429);
    expect(rejected.body.message).toContain('gapAnalysis');
    expect(rejected.body.message).toMatch(/too many/i);
  }, 90000);
});
