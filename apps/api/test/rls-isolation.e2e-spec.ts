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
  }, 30000);

  afterAll(async () => {
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
});
