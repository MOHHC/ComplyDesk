import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { addMember, cleanupTenant, createTenant, TenantFixture } from './helpers/fixtures';

describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  let controlId: string;
  let contributor: { userId: string; token: string };
  let otherContributor: { userId: string; token: string };
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    fixture = await createTenant(app.getHttpServer(), suffix);
    const controls = await request(app.getHttpServer())
      .get('/controls')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);
    controlId = controls.body[0].id;

    contributor = await addMember(fixture.tenantId, Role.CONTRIBUTOR, `${suffix}-c1`);
    otherContributor = await addMember(fixture.tenantId, Role.CONTRIBUTOR, `${suffix}-c2`);
  }, 30000);

  afterAll(async () => {
    await cleanupTenant(fixture.tenantId);
    await app.close();
  });

  it('lets an OWNER assign a control to a member with a due date', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Collect Q3 evidence',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    expect(res.body.controlId).toBe(controlId);
    expect(res.body.assigneeId).toBe(contributor.userId);
    expect(res.body.status).toBe('TODO');
  });

  it('rejects a CONTRIBUTOR trying to assign a task', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${contributor.token}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Self-assign',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(403);
  });

  it('rejects assigning to someone who is not a member of this workspace', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: randomUUID(),
        title: 'Assign to nobody',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(400);
  });

  it('lists tasks, filterable by assignee', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks?assigneeId=${contributor.userId}`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((t: { assigneeId: string }) => t.assigneeId === contributor.userId)).toBe(
      true,
    );
  });

  it('lets the assigned CONTRIBUTOR move their own task to IN_PROGRESS', async () => {
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Task for status test',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}/status`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${contributor.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it("blocks a CONTRIBUTOR from updating a task assigned to someone else", async () => {
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Not yours',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}/status`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${otherContributor.token}`)
      .send({ status: 'DONE' })
      .expect(403);
  });

  it('lets an ADMIN reassign a task via the full update route', async () => {
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'Reassign me',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    const admin = await addMember(fixture.tenantId, Role.ADMIN, `${suffix}-admin`);
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: otherContributor.userId })
      .expect(200);

    expect(res.body.assigneeId).toBe(otherContributor.userId);
  });

  it("rejects a CONTRIBUTOR's attempt to use the full update route at all", async () => {
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({
        controlId,
        assigneeId: contributor.userId,
        title: 'No full edit for contributors',
        dueDate: '2026-12-01T00:00:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}`)
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${contributor.token}`)
      .send({ title: 'Hijacked' })
      .expect(403);
  });
});
