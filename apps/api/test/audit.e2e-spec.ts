import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { addMember, cleanupTenant, createTenant, ownerClient, TenantFixture } from './helpers/fixtures';

/**
 * The audit row commits inside the *same* transaction as the mutation it
 * describes (see AuditInterceptor / TenantTransactionMiddleware) — so a
 * later request always sees both or neither, which is the guarantee that
 * actually matters. But supertest's request() resolves once the HTTP
 * response bytes are received, and the transaction's COMMIT is sent
 * slightly *after* that (once TenantTransactionMiddleware's 'finish'
 * listener resolves the promise the $transaction callback is awaiting).
 * Under concurrent test-suite load that gap can outlast a single
 * immediate query on a separate connection. Polling a few times closes
 * that gap without weakening what's actually being tested.
 */
async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result !== null) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
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
    owner = ownerClient();

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
    await owner.$disconnect();
    await app.close();
  });

  it('records signup itself, written directly since no tenant context exists beforehand', async () => {
    const events = await waitFor(async () => {
      const rows = await owner.auditEvent.findMany({
        where: { tenantId: fixture.tenantId, action: 'auth.signup' },
      });
      return rows.length > 0 ? rows : null;
    });
    expect(events).toHaveLength(1);
    expect(events[0].targetType).toBe('Tenant');
    expect(events[0].targetId).toBe(fixture.tenantId);
    expect(events[0].statusCode).toBe(201);
  });

  it('records a login, with the actor and a redacted password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', `${fixture.slug}.localhost`)
      .send({ email: `owner-${suffix}@example.com`, password: 'password123' })
      .expect(201);

    const events = await waitFor(async () => {
      const rows = await owner.auditEvent.findMany({
        where: { tenantId: fixture.tenantId, action: 'auth.login' },
        orderBy: { createdAt: 'desc' },
      });
      return rows.length > 0 ? rows : null;
    });
    expect(events[0].actorUserId).toBe(fixture.ownerId);
    expect(events[0].statusCode).toBe(201);
    const diff = events[0].diff as any;
    expect(diff.body.after.password).toBe('[redacted]');
    expect(diff.body.after.email).toBe(`owner-${suffix}@example.com`);
  });

  it('records a structured before/after diff for a task creation', async () => {
    const contributor = await addMember(fixture.tenantId, Role.CONTRIBUTOR, `${suffix}-a1`);

    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Audited task',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    const event = await waitFor(() =>
      owner.auditEvent.findFirst({
        where: { tenantId: fixture.tenantId, action: 'task.create', targetId: created.body.id },
      }),
    );
    expect(event.targetType).toBe('Task');
    expect(event.actorUserId).toBe(fixture.ownerId);
    const diff = event.diff as any;
    expect(diff.title.before).toBeNull();
    expect(diff.title.after).toBe('Audited task');
    expect(diff.assigneeId.after).toBe(contributor.userId);
  });

  it('records only the changed field on a status update, not the whole row', async () => {
    const contributor = await addMember(fixture.tenantId, Role.CONTRIBUTOR, `${suffix}-a2`);
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Status diff task',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}/status`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${contributor.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const event = await waitFor(() =>
      owner.auditEvent.findFirst({
        where: {
          tenantId: fixture.tenantId,
          action: 'task.updateStatus',
          targetId: created.body.id,
        },
      }),
    );
    expect(event.actorUserId).toBe(contributor.userId);
    const diff = event.diff as any;
    expect(diff.status).toEqual({ before: 'TODO', after: 'IN_PROGRESS' });
    expect(diff.title).toBeUndefined();
  });

  it('does not record a request a Guard rejected before reaching the interceptor', async () => {
    const before = await owner.auditEvent.count({
      where: { tenantId: fixture.tenantId, action: 'task.create' },
    });

    await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: randomUUID(),
        title: 'Will 400, not audited either way',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(400);

    const auditor = await addMember(fixture.tenantId, Role.AUDITOR, `${suffix}-a3`);
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${auditor.token}`)
      .send({
        controlId,
        assigneeId: fixture.ownerId,
        title: 'Rejected by RolesGuard',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(403);

    const after = await waitFor(async () => {
      const count = await owner.auditEvent.count({
        where: { tenantId: fixture.tenantId, action: 'task.create' },
      });
      return count > before ? count : null;
    });
    // The Guard rejection (403) produces no row (documented limitation).
    // The 400 comes from inside the handler, so it IS caught — expected
    // to add exactly one row via the interceptor's catchError path, and
    // no more even after both requests have long since settled.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = await owner.auditEvent.count({
      where: { tenantId: fixture.tenantId, action: 'task.create' },
    });
    expect(after).toBe(before + 1);
    expect(settled).toBe(before + 1);
  });

  it('records an evidence upload with the created file metadata as the diff', async () => {
    const res = await request(app.getHttpServer())
      .post(`/controls/${controlId}/evidence`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .attach('file', Buffer.from('audited evidence'), 'audited.txt')
      .expect(201);

    const event = await waitFor(() =>
      owner.auditEvent.findFirst({
        where: { tenantId: fixture.tenantId, action: 'evidence.upload', targetId: res.body.id },
      }),
    );
    expect(event.targetType).toBe('Evidence');
    const diff = event.diff as any;
    expect(diff.fileName.after).toBe('audited.txt');
    expect(diff.fileName.before).toBeNull();
  });
});
