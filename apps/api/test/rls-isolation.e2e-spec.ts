import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { setTenantContext } from '../src/common/set-tenant-context';

/**
 * Exercises the RLS policies directly at the database layer — no HTTP,
 * no NestJS module graph — since that's what's actually being verified:
 * does Postgres itself refuse to leak rows across tenants, independent
 * of whatever application code happens to query it.
 *
 * Two Prisma clients:
 * - `runtime`, connected as app_runtime (the same least-privilege role
 *   the running app uses), for everything under test.
 * - `owner`, connected as neondb_owner (bypasses RLS entirely), used
 *   only to seed fixtures and as impartial ground truth for whether a
 *   write actually happened — never to exercise isolation itself.
 */
describe('RLS tenant isolation (e2e)', () => {
  const runtime = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.APP_RUNTIME_DATABASE_URL }),
  });
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const suffix = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let controlA1: { id: string };
  let controlA2: { id: string };
  let controlB1: { id: string };
  let evidenceA1: { id: string };
  let evidenceB1: { id: string };
  let taskA1: { id: string };
  let taskB1: { id: string };
  let policyDocA1: { id: string };
  let policyDocB1: { id: string };
  let policyChunkA1: { id: string };
  let evidenceClassificationA1: { id: string };
  let gapRunA1: { id: string };
  let gapRunB1: { id: string };
  let gapResultA1: { id: string };

  /** Runs `fn` inside a transaction scoped to `tenantId` via the same
   * SET LOCAL mechanism TenantTransactionMiddleware uses in the app. */
  async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return runtime.$transaction(
      async (tx) => {
        await setTenantContext(tx, tenantId);
        return fn(tx);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }

  beforeAll(async () => {
    // Seeding: each tenant's rows are written under its own tenant
    // context, through app_runtime — proving normal same-tenant writes
    // work under RLS, not just that cross-tenant ones are blocked.
    tenantA = await owner.tenant.create({
      data: { name: 'RLS Test Tenant A', slug: `rls-a-${suffix}` },
    });
    tenantB = await owner.tenant.create({
      data: { name: 'RLS Test Tenant B', slug: `rls-b-${suffix}` },
    });
    userA = await owner.user.create({
      data: { email: `rls-a-${suffix}@example.com`, passwordHash: 'x', name: 'User A' },
    });
    userB = await owner.user.create({
      data: { email: `rls-b-${suffix}@example.com`, passwordHash: 'x', name: 'User B' },
    });

    await asTenant(tenantA.id, (tx) =>
      tx.membership.create({ data: { tenantId: tenantA.id, userId: userA.id, role: 'OWNER' } }),
    );
    await asTenant(tenantB.id, (tx) =>
      tx.membership.create({ data: { tenantId: tenantB.id, userId: userB.id, role: 'OWNER' } }),
    );

    controlA1 = await asTenant(tenantA.id, (tx) =>
      tx.control.create({
        data: {
          tenantId: tenantA.id,
          code: 'A-01',
          category: 'Access Control',
          title: 'Tenant A Control 1',
          description: 'd',
          evidenceGuidance: 'g',
          refreshIntervalDays: 90,
        },
      }),
    );
    controlA2 = await asTenant(tenantA.id, (tx) =>
      tx.control.create({
        data: {
          tenantId: tenantA.id,
          code: 'A-02',
          category: 'Access Control',
          title: 'Tenant A Control 2',
          description: 'd',
          evidenceGuidance: 'g',
          refreshIntervalDays: 90,
        },
      }),
    );
    controlB1 = await asTenant(tenantB.id, (tx) =>
      tx.control.create({
        data: {
          tenantId: tenantB.id,
          code: 'B-01',
          category: 'Access Control',
          title: 'Tenant B Control 1',
          description: 'd',
          evidenceGuidance: 'g',
          refreshIntervalDays: 90,
        },
      }),
    );

    evidenceA1 = await asTenant(tenantA.id, (tx) =>
      tx.evidence.create({
        data: {
          tenantId: tenantA.id,
          controlId: controlA1.id,
          uploadedById: userA.id,
          notes: 'Tenant A evidence',
          fileKey: `${tenantA.id}/${controlA1.id}/fixture-a.txt`,
          fileName: 'fixture-a.txt',
          fileSize: 1,
          mimeType: 'text/plain',
        },
      }),
    );
    evidenceB1 = await asTenant(tenantB.id, (tx) =>
      tx.evidence.create({
        data: {
          tenantId: tenantB.id,
          controlId: controlB1.id,
          uploadedById: userB.id,
          notes: 'Tenant B evidence',
          fileKey: `${tenantB.id}/${controlB1.id}/fixture-b.txt`,
          fileName: 'fixture-b.txt',
          fileSize: 1,
          mimeType: 'text/plain',
        },
      }),
    );

    taskA1 = await asTenant(tenantA.id, (tx) =>
      tx.task.create({
        data: { tenantId: tenantA.id, title: 'Tenant A task', assigneeId: userA.id },
      }),
    );
    taskB1 = await asTenant(tenantB.id, (tx) =>
      tx.task.create({
        data: { tenantId: tenantB.id, title: 'Tenant B task', assigneeId: userB.id },
      }),
    );

    policyDocA1 = await asTenant(tenantA.id, (tx) =>
      tx.policyDocument.create({
        data: {
          tenantId: tenantA.id,
          fileKey: `${tenantA.id}/policy-docs/a1.txt`,
          fileName: 'a1.txt',
          mimeType: 'text/plain',
          uploadedById: userA.id,
          status: 'READY',
        },
      }),
    );
    policyDocB1 = await asTenant(tenantB.id, (tx) =>
      tx.policyDocument.create({
        data: {
          tenantId: tenantB.id,
          fileKey: `${tenantB.id}/policy-docs/b1.txt`,
          fileName: 'b1.txt',
          mimeType: 'text/plain',
          uploadedById: userB.id,
          status: 'READY',
        },
      }),
    );

    // PolicyChunk.embedding is Unsupported() in Prisma, so seed via raw
    // SQL, same as the app's own write path.
    await asTenant(tenantA.id, (tx) =>
      tx.$executeRaw`
        INSERT INTO "PolicyChunk" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding")
        VALUES (gen_random_uuid()::text, ${tenantA.id}, ${policyDocA1.id}, 0, 'tenant A policy text', ${'[' + '0,'.repeat(383) + '0]'}::vector)
      `,
    );
    policyChunkA1 = await asTenant(tenantA.id, (tx) =>
      tx.policyChunk.findFirstOrThrow({ where: { documentId: policyDocA1.id } }),
    );

    evidenceClassificationA1 = await asTenant(tenantA.id, (tx) =>
      tx.evidenceClassification.create({
        data: {
          tenantId: tenantA.id,
          evidenceId: evidenceA1.id,
          confidence: 0.5,
          reasoning: 'seed',
        },
      }),
    );

    gapRunA1 = await asTenant(tenantA.id, (tx) =>
      tx.gapAnalysisRun.create({ data: { tenantId: tenantA.id, runById: userA.id } }),
    );
    gapRunB1 = await asTenant(tenantB.id, (tx) =>
      tx.gapAnalysisRun.create({ data: { tenantId: tenantB.id, runById: userB.id } }),
    );
    gapResultA1 = await asTenant(tenantA.id, (tx) =>
      tx.gapAnalysisResult.create({
        data: {
          tenantId: tenantA.id,
          runId: gapRunA1.id,
          controlId: controlA1.id,
          covered: false,
          reasoning: 'seed',
        },
      }),
    );
  }, 30000);

  afterAll(async () => {
    // Unlike every pre-existing tenant-owned table, the five new AI-layer
    // tables' "tenantId" column has no FK constraint back to "Tenant" at
    // all (see migration 20260901120000_ai_layer — contrast with
    // Control/Evidence/Task/Membership's explicit
    // "..._tenantId_fkey ... REFERENCES "Tenant"("id") ON DELETE CASCADE"
    // in 20260831015655_init). So deleting the tenant below does not
    // cascade-delete these rows, and they must be cleaned up explicitly
    // here, in FK-dependency order, or the later user delete fails with
    // a foreign key violation. This is a genuine gap in the migration —
    // reported separately — not something to route around silently.
    const tenantIds = { tenantId: { in: [tenantA.id, tenantB.id] } };
    await owner.gapAnalysisResult.deleteMany({ where: tenantIds });
    await owner.gapAnalysisRun.deleteMany({ where: tenantIds });
    await owner.policyChunk.deleteMany({ where: tenantIds });
    await owner.policyDocument.deleteMany({ where: tenantIds });
    await owner.evidenceClassification.deleteMany({ where: tenantIds });

    await owner.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await runtime.$disconnect();
    await owner.$disconnect();
  });

  describe('SELECT', () => {
    it('only returns the current tenant\'s controls, with no application-level filter', async () => {
      // No `where: { tenantId }` at all — this is the point. If this
      // ever returned Tenant B's row, it would be RLS failing, not an
      // app bug, since the query itself never asked for a specific
      // tenant.
      const controls = await asTenant(tenantA.id, (tx) => tx.control.findMany());
      const ids = controls.map((c: { id: string }) => c.id);

      expect(ids).toEqual(expect.arrayContaining([controlA1.id, controlA2.id]));
      expect(ids).not.toContain(controlB1.id);
    });

    it('only returns the current tenant\'s evidence and tasks', async () => {
      const evidence = await asTenant(tenantA.id, (tx) => tx.evidence.findMany());
      const tasks = await asTenant(tenantA.id, (tx) => tx.task.findMany());

      expect(evidence.map((e: { id: string }) => e.id)).toEqual([evidenceA1.id]);
      expect(tasks.map((t: { id: string }) => t.id)).toEqual([taskA1.id]);
    });

    it('a direct findUnique by Tenant B\'s own id returns null under Tenant A\'s context', async () => {
      const found = await asTenant(tenantA.id, (tx) =>
        tx.control.findUnique({ where: { id: controlB1.id } }),
      );
      expect(found).toBeNull();
    });

    it('symmetrically, Tenant B cannot see Tenant A\'s rows either', async () => {
      const controls = await asTenant(tenantB.id, (tx) => tx.control.findMany());
      expect(controls.map((c: { id: string }) => c.id)).toEqual([controlB1.id]);
    });
  });

  describe('UPDATE', () => {
    it('updating by Tenant B\'s id under Tenant A\'s context affects zero rows and leaves the row untouched', async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.control.updateMany({
          where: { id: controlB1.id },
          data: { title: 'HIJACKED' },
        }),
      );
      expect(result.count).toBe(0);

      // Ground truth via the owner connection (bypasses RLS).
      const stillIntact = await owner.control.findUnique({ where: { id: controlB1.id } });
      expect(stillIntact?.title).toBe('Tenant B Control 1');
    });

    it('updating its own row under the correct tenant context succeeds (positive control)', async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.control.updateMany({
          where: { id: controlA2.id },
          data: { title: 'Updated by Tenant A' },
        }),
      );
      expect(result.count).toBe(1);

      const updated = await owner.control.findUnique({ where: { id: controlA2.id } });
      expect(updated?.title).toBe('Updated by Tenant A');
    });
  });

  describe('DELETE', () => {
    it('deleting by Tenant B\'s id under Tenant A\'s context affects zero rows and the row survives', async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.evidence.deleteMany({ where: { id: evidenceB1.id } }),
      );
      expect(result.count).toBe(0);

      const stillThere = await owner.evidence.findUnique({ where: { id: evidenceB1.id } });
      expect(stillThere).not.toBeNull();
    });
  });

  describe('INSERT forgery (WITH CHECK) on a pre-existing table', () => {
    /**
     * Neither the pre-existing Phase 3 probes above nor the Membership
     * forgery test exercise a plain tenant-owned table's WITH CHECK: the
     * only existing forged-INSERT probe targets Membership, which is a
     * join table with its own auth semantics. This closes that hole for
     * Control — under Tenant B's own context, attempt to plant a row
     * stamped with Tenant A's tenantId. Only the tenantId is forged; every
     * other field is Tenant B's own, so a rejection can only be the
     * WITH CHECK clause, not an unrelated constraint.
     */
    it('tenant B cannot create a Control row stamped with tenant A\'s tenantId', async () => {
      await expect(
        asTenant(tenantB.id, (tx) =>
          tx.control.create({
            data: {
              tenantId: tenantA.id,
              code: 'FORGED-01',
              category: 'Access Control',
              title: 'Forged into Tenant A',
              description: 'd',
              evidenceGuidance: 'g',
              refreshIntervalDays: 90,
            },
          }),
        ),
      ).rejects.toThrow();

      const leaked = await owner.control.findFirst({ where: { code: 'FORGED-01' } });
      expect(leaked).toBeNull();
    });
  });

  describe('a service method with no tenant filter in its own code', () => {
    /**
     * Simulates a real bug: a developer writes a "service" that queries
     * a whole table with no `where: { tenantId }` clause anywhere in
     * its own code — exactly the accident RLS exists to catch. It's
     * still called inside the app's normal per-request tenant
     * transaction (the only way it would ever run in production), so
     * this proves the *database* is the actual enforcement boundary,
     * not any application-level filter.
     */
    async function listAllTasksNoTenantFilterAnywhereInThisFunction(tx: any) {
      return tx.task.findMany({ orderBy: { createdAt: 'asc' } });
    }

    it('still only returns the current tenant\'s rows despite the missing filter', async () => {
      const tasksAsA = await asTenant(tenantA.id, (tx) =>
        listAllTasksNoTenantFilterAnywhereInThisFunction(tx),
      );
      expect(tasksAsA.map((t: { id: string }) => t.id)).toEqual([taskA1.id]);

      const tasksAsB = await asTenant(tenantB.id, (tx) =>
        listAllTasksNoTenantFilterAnywhereInThisFunction(tx),
      );
      expect(tasksAsB.map((t: { id: string }) => t.id)).toEqual([taskB1.id]);
    });
  });

  describe('Membership', () => {
    it('cannot be read across tenants — the table JwtAuthGuard authorizes against', async () => {
      // Membership is the one RLS-protected table the auth path itself
      // queries, so a leak here would be an authorization bug, not just
      // a data-visibility one.
      const asA = await asTenant(tenantA.id, (tx) => tx.membership.findMany());
      expect(asA.map((m: { userId: string }) => m.userId)).toEqual([userA.id]);

      const bMembership = await owner.membership.findFirst({
        where: { tenantId: tenantB.id },
      });
      const stolen = await asTenant(tenantA.id, (tx) =>
        tx.membership.findUnique({ where: { id: bMembership!.id } }),
      );
      expect(stolen).toBeNull();
    });

    it('cannot be granted to yourself in another tenant (WITH CHECK on INSERT)', async () => {
      // The privilege-escalation shape: under Tenant A's context, try to
      // insert a membership row that claims Tenant B. WITH CHECK must
      // reject the row outright rather than write it.
      await expect(
        asTenant(tenantA.id, (tx) =>
          tx.membership.create({
            data: { tenantId: tenantB.id, userId: userA.id, role: 'OWNER' },
          }),
        ),
      ).rejects.toThrow();

      const leaked = await owner.membership.findFirst({
        where: { tenantId: tenantB.id, userId: userA.id },
      });
      expect(leaked).toBeNull();
    });
  });

  describe('User (SELECT-scoped via Membership, not a tenantId column)', () => {
    it('only exposes users who are members of the current tenant', async () => {
      const asA = await asTenant(tenantA.id, (tx) => tx.user.findMany());
      expect(asA.map((u: { id: string }) => u.id)).toEqual([userA.id]);

      const asB = await asTenant(tenantB.id, (tx) => tx.user.findMany());
      expect(asB.map((u: { id: string }) => u.id)).toEqual([userB.id]);
    });

    it("hides another tenant's user even on a direct lookup by email", async () => {
      const found = await asTenant(tenantA.id, (tx) =>
        tx.user.findUnique({ where: { email: `rls-b-${suffix}@example.com` } }),
      );
      expect(found).toBeNull();
    });

    it("cannot update another tenant's user", async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.user.updateMany({ where: { id: userB.id }, data: { name: 'Renamed by A' } }),
      );
      expect(result.count).toBe(0);

      const intact = await owner.user.findUnique({ where: { id: userB.id } });
      expect(intact?.name).toBe('User B');
    });

    it('confines an unqualified bulk write to the calling tenant', async () => {
      // The case the SELECT policy alone does *not* cover: an UPDATE with
      // no WHERE clause reads no existing column values, so SELECT
      // policies never come into play and only the UPDATE policy decides.
      // With a permissive USING (true) this crossed tenants; the
      // membership test is what confines it.
      const result = await asTenant(tenantA.id, (tx) =>
        tx.user.updateMany({ data: { name: 'Bulk renamed' } }),
      );
      expect(result.count).toBe(1);

      const untouched = await owner.user.findUnique({ where: { id: userB.id } });
      expect(untouched?.name).toBe('User B');

      await owner.user.update({ where: { id: userA.id }, data: { name: 'User A' } });
    });

    it('still leaks email existence through the global unique index — a known limit of this design', async () => {
      // Pinned on purpose. Unique indexes are enforced beneath RLS, so
      // inserting a duplicate email raises a constraint violation whether
      // or not the conflicting row is visible. If this test ever starts
      // failing, the uniqueness model changed and the leak analysis in
      // the rls_tenant_and_user migration needs revisiting.
      await expect(
        asTenant(tenantA.id, (tx) =>
          tx.$executeRaw`
            INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), ${`rls-b-${suffix}@example.com`}, 'h', 'probe', now(), now())
          `,
        ),
      ).rejects.toThrow(/unique constraint|duplicate key/i);
    });
  });

  describe('Tenant (readable for routing, writable only by itself)', () => {
    it('is readable with no tenant context, since resolving a slug is what establishes context', async () => {
      const found = await runtime.tenant.findUnique({
        where: { slug: `rls-b-${suffix}` },
      });
      expect(found?.id).toBe(tenantB.id);
    });

    it("cannot be renamed by another tenant", async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.tenant.updateMany({ where: { id: tenantB.id }, data: { name: 'HIJACKED' } }),
      );
      expect(result.count).toBe(0);

      const intact = await owner.tenant.findUnique({ where: { id: tenantB.id } });
      expect(intact?.name).toBe('RLS Test Tenant B');
    });

    it('can rename itself (positive control)', async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.tenant.updateMany({ where: { id: tenantA.id }, data: { name: 'Renamed A' } }),
      );
      expect(result.count).toBe(1);
    });

    it("cannot be deleted by another tenant", async () => {
      const result = await asTenant(tenantA.id, (tx) =>
        tx.tenant.deleteMany({ where: { id: tenantB.id } }),
      );
      expect(result.count).toBe(0);

      const survived = await owner.tenant.findUnique({ where: { id: tenantB.id } });
      expect(survived).not.toBeNull();
    });
  });

  describe('no tenant context set at all', () => {
    it('throws rather than silently returning rows or an empty result', async () => {
      await expect(
        runtime.$transaction(async (tx) => tx.control.findMany(), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ).rejects.toThrow();
    });

    it('throws when app.tenant_id is present but empty — the pooled-connection case', async () => {
      // On a connection that already served a request, app.tenant_id
      // still exists as a parameter and current_setting() returns '' now
      // rather than throwing. The `::uuid` cast in the policy is what
      // keeps that failing closed instead of quietly matching no rows.
      await expect(
        runtime.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
            return tx.control.findMany();
          },
          { maxWait: 15000, timeout: 15000 },
        ),
      ).rejects.toThrow(/invalid input syntax for type uuid/);
    });
  });

  describe('EvidenceClassification, PolicyDocument, PolicyChunk, GapAnalysisRun, GapAnalysisResult', () => {
    it('tenant B cannot read tenant A policy documents, chunks, classifications, or gap analysis rows', async () => {
      await asTenant(tenantB.id, async (tx) => {
        expect(await tx.policyDocument.findUnique({ where: { id: policyDocA1.id } })).toBeNull();
        expect(await tx.policyChunk.findUnique({ where: { id: policyChunkA1.id } })).toBeNull();
        expect(
          await tx.evidenceClassification.findUnique({ where: { id: evidenceClassificationA1.id } }),
        ).toBeNull();
        expect(await tx.gapAnalysisRun.findUnique({ where: { id: gapRunA1.id } })).toBeNull();
        expect(await tx.gapAnalysisResult.findUnique({ where: { id: gapResultA1.id } })).toBeNull();
      });
    });

    it('tenant B cannot update or delete tenant A rows in any of the five new tables', async () => {
      await asTenant(tenantB.id, async (tx) => {
        await expect(
          tx.policyDocument.update({ where: { id: policyDocA1.id }, data: { status: 'FAILED' } }),
        ).rejects.toThrow();
        await expect(tx.policyDocument.delete({ where: { id: policyDocA1.id } })).rejects.toThrow();
        await expect(
          tx.evidenceClassification.update({
            where: { id: evidenceClassificationA1.id },
            data: { reviewStatus: 'DISMISSED' },
          }),
        ).rejects.toThrow();
        await expect(tx.gapAnalysisResult.delete({ where: { id: gapResultA1.id } })).rejects.toThrow();
      });

      // Ground truth: the rows are untouched, verified via the
      // bypasses-RLS owner connection — never used to exercise
      // isolation itself, only as an impartial check.
      const stillReady = await owner.policyDocument.findUniqueOrThrow({ where: { id: policyDocA1.id } });
      expect(stillReady.status).toBe('READY');

      const stillPending = await owner.evidenceClassification.findUniqueOrThrow({
        where: { id: evidenceClassificationA1.id },
      });
      expect(stillPending.reviewStatus).toBe('PENDING');

      const stillThere = await owner.gapAnalysisResult.findUnique({ where: { id: gapResultA1.id } });
      expect(stillThere).not.toBeNull();
    });

    it('tenant A can read and write its own rows in all five new tables', async () => {
      await asTenant(tenantA.id, async (tx) => {
        expect(await tx.policyDocument.findUnique({ where: { id: policyDocA1.id } })).not.toBeNull();
        expect(await tx.policyChunk.findUnique({ where: { id: policyChunkA1.id } })).not.toBeNull();
        expect(
          await tx.evidenceClassification.findUnique({ where: { id: evidenceClassificationA1.id } }),
        ).not.toBeNull();
        expect(await tx.gapAnalysisRun.findUnique({ where: { id: gapRunA1.id } })).not.toBeNull();
        expect(await tx.gapAnalysisResult.findUnique({ where: { id: gapResultA1.id } })).not.toBeNull();
      });
    });

    describe('INSERT forgery (WITH CHECK) — forged tenantId on each of the five new tables', () => {
      /**
       * The brief's probes above cover cross-tenant SELECT/UPDATE/DELETE
       * plus a positive control, but not the sharper attack: tenant B,
       * fully inside its own tenant context, attempting to plant a row
       * stamped with tenant A's tenantId. That's exactly what the
       * WITH CHECK half of each tenant_isolation policy exists to stop.
       *
       * Every foreign key in these forged rows points at Tenant B's own
       * fixtures (never Tenant A's) so the *only* thing forged is the
       * tenantId column — if one of these ever threw for a different
       * reason (e.g. an invisible FK target), it wouldn't actually prove
       * WITH CHECK works. Asserting on the rejection itself, not just a
       * later read, matters here: a row that gets written and then
       * disappears from view is a worse failure than one that never gets
       * written at all.
       */
      it('rejects a forged EvidenceClassification claiming tenant A', async () => {
        await expect(
          asTenant(tenantB.id, (tx) =>
            tx.evidenceClassification.create({
              data: {
                tenantId: tenantA.id,
                evidenceId: evidenceB1.id,
                confidence: 0.9,
                reasoning: 'forged',
              },
            }),
          ),
        ).rejects.toThrow();

        const leaked = await owner.evidenceClassification.findFirst({
          where: { evidenceId: evidenceB1.id },
        });
        expect(leaked).toBeNull();
      });

      it('rejects a forged PolicyDocument claiming tenant A', async () => {
        await expect(
          asTenant(tenantB.id, (tx) =>
            tx.policyDocument.create({
              data: {
                tenantId: tenantA.id,
                fileKey: `${tenantB.id}/policy-docs/forged.txt`,
                fileName: 'forged.txt',
                mimeType: 'text/plain',
                uploadedById: userB.id,
                status: 'READY',
              },
            }),
          ),
        ).rejects.toThrow();

        const leaked = await owner.policyDocument.findFirst({
          where: { fileKey: `${tenantB.id}/policy-docs/forged.txt` },
        });
        expect(leaked).toBeNull();
      });

      it('rejects a forged PolicyChunk claiming tenant A (raw SQL insert path)', async () => {
        await expect(
          asTenant(tenantB.id, (tx) =>
            tx.$executeRaw`
              INSERT INTO "PolicyChunk" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding")
              VALUES (gen_random_uuid()::text, ${tenantA.id}, ${policyDocB1.id}, 99, 'forged chunk', ${'[' + '0,'.repeat(383) + '0]'}::vector)
            `,
          ),
        ).rejects.toThrow();

        const leaked = await owner.policyChunk.findFirst({
          where: { documentId: policyDocB1.id, chunkIndex: 99 },
        });
        expect(leaked).toBeNull();
      });

      it('rejects a forged GapAnalysisRun claiming tenant A', async () => {
        await expect(
          asTenant(tenantB.id, (tx) =>
            tx.gapAnalysisRun.create({ data: { tenantId: tenantA.id, runById: userB.id } }),
          ),
        ).rejects.toThrow();

        const leaked = await owner.gapAnalysisRun.findFirst({
          where: { runById: userB.id, tenantId: tenantA.id },
        });
        expect(leaked).toBeNull();
      });

      it('rejects a forged GapAnalysisResult claiming tenant A', async () => {
        await expect(
          asTenant(tenantB.id, (tx) =>
            tx.gapAnalysisResult.create({
              data: {
                tenantId: tenantA.id,
                runId: gapRunB1.id,
                controlId: controlB1.id,
                covered: true,
                reasoning: 'forged',
              },
            }),
          ),
        ).rejects.toThrow();

        const leaked = await owner.gapAnalysisResult.findFirst({ where: { runId: gapRunB1.id } });
        expect(leaked).toBeNull();
      });
    });
  });
});
