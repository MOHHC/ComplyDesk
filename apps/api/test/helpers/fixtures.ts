import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// Matches AuthModule's fallback (process.env.JWT_SECRET ?? this literal).
// .env.test deliberately doesn't set JWT_SECRET, so this is the real
// secret the app under test signs and verifies with.
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '1h' });
}

/** Owner-privileged client for fixture setup only — bypasses RLS. Never
 * used to exercise the authorization surface under test; that's always
 * done through the app's own HTTP endpoints with a role-appropriate
 * token. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  ownerId: string;
  ownerToken: string;
}

/** Signs up a fresh tenant through the real HTTP endpoint — exercises
 * signup itself (control seeding, audit row) rather than faking tenant
 * creation, since every other fixture in a suite depends on this having
 * actually happened correctly. */
export async function createTenant(server: unknown, suffix: string): Promise<TenantFixture> {
  const slug = `phase3-${suffix}`;
  const res = await request(server)
    .post('/auth/signup')
    .set('Host', `${slug}.localhost`)
    .send({
      email: `owner-${suffix}@example.com`,
      password: 'password123',
      name: 'Owner',
      tenantName: 'Phase 3 Test Co',
      tenantSlug: slug,
    })
    .expect(201);

  const owner = ownerClient();
  const tenant = await owner.tenant.findUniqueOrThrow({ where: { slug } });
  const ownerUser = await owner.user.findUniqueOrThrow({
    where: { email: `owner-${suffix}@example.com` },
  });
  await owner.$disconnect();

  return {
    tenantId: tenant.id,
    slug,
    ownerId: ownerUser.id,
    ownerToken: res.body.accessToken,
  };
}

/** Adds a member with a given role directly via the owner connection —
 * faster fixture setup than round-tripping through the real invite flow
 * for every test that just needs *a* member of some role already in
 * place, not a way to sidestep the authorization surface: every test
 * still logs in / calls the API as this user through the real guards.
 * invites.e2e-spec.ts exercises the invite flow itself end to end. */
export async function addMember(
  tenantId: string,
  role: Role,
  suffix: string,
): Promise<{ userId: string; token: string; email: string }> {
  const owner = ownerClient();
  const userId = randomUUID();
  const email = `${role.toLowerCase()}-${suffix}@example.com`;
  await owner.$executeRaw`
    INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, 'x', ${role}, now(), now())
  `;
  await owner.membership.create({ data: { tenantId, userId, role } });
  await owner.$disconnect();
  return { userId, token: signToken(userId), email };
}

export async function cleanupTenant(tenantId: string): Promise<void> {
  const owner = ownerClient();
  await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
}
