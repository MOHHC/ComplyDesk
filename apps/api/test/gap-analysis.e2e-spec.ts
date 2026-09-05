import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { AI_PROVIDER } from '../src/ai/ai-provider.token';
import { FakeAiProvider } from '../src/ai/fake-ai-provider.service';
import { createTenant, addMember, cleanupTenant, ownerClient, TenantFixture } from './helpers/fixtures';

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

  it('resolves a covered result to the exact policy chunk the AI cited, not just any chunk', async () => {
    // Dedicated tenant, isolated from the other tests' policy uploads and
    // gap-analysis runs above, so the pgvector candidate search sees
    // exactly the two PolicyChunk rows this test seeds and nothing else.
    const covSuffix = `${suffix}-cov`;
    const covFixture = await createTenant(app.getHttpServer(), covSuffix);

    try {
      const controlsRes = await request(app.getHttpServer())
        .get('/controls')
        .set('Host', `${covFixture.slug}.localhost`)
        .set('Authorization', `Bearer ${covFixture.ownerToken}`)
        .expect(200);
      const coveredControl = controlsRes.body[0];
      const contrastControl = controlsRes.body[1];
      const steeredDescription = `${coveredControl.description} COVERED:1`;

      // GapAnalysisService.run() embeds *this exact string*
      // (control.description, after our update below) as the pgvector
      // query for this control. We need that same vector to seed
      // PolicyChunk rows whose similarity ordering we fully control, so
      // we compute it here with the real FakeAiProvider class (imported
      // above, already wired as AI_PROVIDER for this whole suite) rather
      // than a hand-copied reimplementation — zero risk of the two
      // algorithms drifting apart.
      const embedder = new FakeAiProvider();
      const queryVector = await embedder.embed(steeredDescription);
      const nearVector = queryVector; // identical to the query -> cosine distance 0 (closest possible)
      const farVector = queryVector.map((v) => -v); // antipodal -> cosine distance 2 (farthest possible)

      const owner = ownerClient();
      try {
        // Steer FakeAiProvider.checkControlCoverage to report this
        // control covered, citing chunk index 1 — see
        // fake-ai-provider.service.ts's documented "COVERED:<chunkIndex>"
        // convention (matched against the *control's own description*).
        // A direct DB write via the owner connection is the same
        // legitimate fixture-setup pattern helpers/fixtures.ts's
        // addMember already uses: it edits this test's own tenant's
        // data, not the authorization surface under test, and there is
        // no HTTP endpoint to edit a control's description.
        await owner.control.update({
          where: { id: coveredControl.id },
          data: { description: steeredDescription },
        });

        // Seed two PolicyChunk rows directly (raw SQL, same insert shape
        // policy-documents.service.ts itself uses) instead of going
        // through document upload/chunking. This sidesteps depending on
        // FakeAiProvider.embed's char-hash algorithm to *coincidentally*
        // order real document chunks the way we want; instead the
        // embeddings are engineered so the outcome is unambiguous by
        // construction:
        //  - chunk 0 ("distractor"): embedding = queryVector negated ->
        //    the mathematically farthest possible candidate.
        //  - chunk 1 (the one we cite): embedding = queryVector itself
        //    -> the mathematically nearest possible candidate (distance
        //    0), guaranteed to sort first regardless of how the ANN
        //    index approximates the search.
        // Citing chunkIndex 1 while it is the *first* (position 0)
        // candidate in the distance-ordered result is exactly what makes
        // this discriminate a correct `chunkIndex`-value lookup from a
        // buggy array-position lookup: a position-based implementation
        // resolving citedChunkIndex=1 would land on candidates[1], i.e.
        // chunk 0 (the distractor) or undefined -- not chunk 1.
        const doc = await owner.policyDocument.create({
          data: {
            tenantId: covFixture.tenantId,
            fileKey: `${covFixture.tenantId}/policy-docs/seeded.txt`,
            fileName: 'seeded.txt',
            mimeType: 'text/plain',
            uploadedById: covFixture.ownerId,
            status: 'READY',
          },
        });
        const chunk0Id = randomUUID();
        const chunk1Id = randomUUID();
        await owner.$executeRaw`
          INSERT INTO "PolicyChunk" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding")
          VALUES (${chunk0Id}, ${covFixture.tenantId}, ${doc.id}, 0, 'distractor chunk, not the cited one', ${JSON.stringify(farVector)}::vector)
        `;
        await owner.$executeRaw`
          INSERT INTO "PolicyChunk" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding")
          VALUES (${chunk1Id}, ${covFixture.tenantId}, ${doc.id}, 1, 'the actual covering policy chunk', ${JSON.stringify(nearVector)}::vector)
        `;

        const run = await request(app.getHttpServer())
          .post('/gap-analysis/run')
          .set('Host', `${covFixture.slug}.localhost`)
          .set('Authorization', `Bearer ${covFixture.ownerToken}`)
          .expect(201);

        const coveredResult = run.body.results.find(
          (r: { control: { id: string } }) => r.control.id === coveredControl.id,
        );
        const contrastResult = run.body.results.find(
          (r: { control: { id: string } }) => r.control.id === contrastControl.id,
        );
        expect(coveredResult).toBeTruthy();
        expect(contrastResult).toBeTruthy();

        // The steered control: covered, and cited to the *exact* chunk 1
        // row we seeded — not chunk 0, not merely "some truthy id".
        expect(coveredResult.covered).toBe(true);
        expect(coveredResult.citationChunkId).toBe(chunk1Id);
        expect(coveredResult.citationChunkId).not.toBe(chunk0Id);

        // Contrast, in the *same* run: a control with no COVERED marker
        // stays uncovered, so this test would fail if the fake (or the
        // service) always reported everything covered.
        expect(contrastResult.covered).toBe(false);
      } finally {
        await owner.$disconnect();
      }
    } finally {
      await cleanupTenant(covFixture.tenantId);
    }
  }, 60000);
});
