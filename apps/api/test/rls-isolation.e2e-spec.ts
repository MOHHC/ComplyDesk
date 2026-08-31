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

  describe('no tenant context set at all', () => {
    it('throws rather than silently returning rows or an empty result', async () => {
      await expect(
        runtime.$transaction(async (tx) => tx.control.findMany(), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ).rejects.toThrow();
    });
  });
});
