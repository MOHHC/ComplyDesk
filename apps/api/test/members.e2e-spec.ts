import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { addMember, cleanupTenant, createTenant, TenantFixture } from './helpers/fixtures';

describe('Members (e2e)', () => {
  let app: INestApplication;
  let fixture: TenantFixture;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    fixture = await createTenant(app.getHttpServer(), suffix);
  }, 30000);

  afterAll(async () => {
    await cleanupTenant(fixture.tenantId);
    await app.close();
  });

  it('lists members of the current workspace, viewable by any role', async () => {
    const auditor = await addMember(fixture.tenantId, Role.AUDITOR, `${suffix}-m1`);

    const res = await request(app.getHttpServer())
      .get('/members')
      .set('Host', `${fixture.slug}.localhost`)
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(200);

    const userIds = res.body.map((m: { userId: string }) => m.userId);
    expect(userIds).toEqual(expect.arrayContaining([fixture.ownerId, auditor.userId]));
    const ownerRow = res.body.find((m: { userId: string }) => m.userId === fixture.ownerId);
    expect(ownerRow.role).toBe('OWNER');
  });
});
