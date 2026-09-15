import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { InviteInfo, SignupResponse, WorkspaceSummary } from '@complydesk/shared';
import { Role } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { setTenantContext } from '../common/set-tenant-context';
import { SeedControlsService } from '../controls/seed-controls.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { FindWorkspacesDto } from './dto/find-workspaces.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

interface InviteLookupRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: Role;
  expires_at: Date;
  used_at: Date | null;
}

const SALT_ROUNDS = 10;
const UNIQUE_VIOLATION = '23505';

/** Postgres raises 23505 for a unique-index violation. Prisma surfaces raw
 * errors with the driver's SQLSTATE in different places depending on the
 * path, so check the shape rather than a specific Prisma error code. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return (
    e?.code === UNIQUE_VIOLATION ||
    e?.meta?.code === UNIQUE_VIOLATION ||
    (typeof e?.message === 'string' && e.message.includes(UNIQUE_VIOLATION))
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly seedControls: SeedControlsService,
  ) {}

  async signup(dto: SignupDto): Promise<SignupResponse> {
    // User is RLS-protected for SELECT and this check runs before any
    // tenant exists, so it goes through the SECURITY DEFINER helper (see
    // the rls_tenant_and_user migration) rather than a direct read.
    const [{ exists }] = await this.prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT auth_email_exists(${dto.email}) AS exists
    `;
    if (exists) {
      throw new ConflictException('An account with this email already exists');
    }
    // Tenant's SELECT policy is unconditional, so this one still works
    // with no tenant context.
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (existingTenant) {
      throw new ConflictException('This workspace URL is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // Both ids are generated here rather than defaulted by Postgres,
    // because the tenant's id has to be known *before* its own row is
    // inserted: Tenant's INSERT policy checks the new row against
    // app.tenant_id, so the context must already name the tenant being
    // created.
    const tenantId = randomUUID();
    const userId = randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, tenantId);
        await tx.tenant.create({
          data: { id: tenantId, name: dto.tenantName, slug: dto.tenantSlug },
        });

        // Deliberately not tx.user.create(): Prisma always appends
        // RETURNING, and Postgres applies the SELECT policy to returned
        // rows. This user has no Membership yet — it can't, since
        // Membership needs the very id being inserted — so the row would
        // be invisible and the insert rejected outright. Inserting a
        // known id without RETURNING sidesteps the ordering problem
        // entirely; the Membership below is what makes the row readable.
        await tx.$executeRaw`
          INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt")
          VALUES (${userId}, ${dto.email}, ${passwordHash}, ${dto.name}, now(), now())
        `;

        await tx.membership.create({
          data: { tenantId, userId, role: 'OWNER' },
        });

        // createMany issues a plain multi-row INSERT with no RETURNING,
        // so — unlike tx.user.create() above — there's no SELECT-policy
        // interaction to work around here even though these rows have no
        // reader-relevant state yet; it's just the efficient way to
        // insert 18 rows at once.
        await tx.control.createMany({
          data: this.seedControls.getControls().map((seed) => ({
            tenantId,
            code: seed.code,
            category: seed.category,
            title: seed.title,
            description: seed.description,
            evidenceGuidance: seed.evidence_guidance,
            refreshIntervalDays: seed.refresh_interval_days,
          })),
        });

        // The audit interceptor can't cover this request: it only writes
        // through cls.tenantTx, which TenantTransactionMiddleware only
        // opens when a tenant was already resolved *before* the request
        // started — not true here, since this transaction is what creates
        // the tenant. Recorded directly, in the same transaction, once
        // the tenant it belongs to exists.
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorUserId: userId,
            action: 'auth.signup',
            targetType: 'Tenant',
            targetId: tenantId,
            method: 'POST',
            path: '/auth/signup',
            statusCode: 201,
          },
        });
      });
    } catch (err) {
      // The check above is advisory: two concurrent signups for the same
      // email both pass it and the unique index decides. Report that as
      // the same 409 rather than a 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }

    // Returns the tenant it actually created, not an echo of the request:
    // the client builds its redirect from this, so if the slug is ever
    // normalized or deduplicated server-side, the browser still lands on
    // the workspace that exists rather than the one that was asked for.
    return {
      accessToken: this.jwt.sign({ sub: userId }),
      tenantId,
      tenantSlug: dto.tenantSlug,
    };
  }

  /**
   * Which workspaces does this email belong to? Backs the root-domain
   * picker, where there is no subdomain and therefore no tenant context
   * — so this goes through the SECURITY DEFINER helper rather than a
   * normal Membership query, which would throw on the missing
   * app.tenant_id (see the auth_workspaces_for_email migration).
   *
   * Returns an empty array for an unknown email rather than throwing, so
   * the caller can present "no workspaces found" identically whether the
   * account doesn't exist or simply has no memberships.
   */
  async findWorkspaces(dto: FindWorkspacesDto): Promise<WorkspaceSummary[]> {
    return this.prisma.$queryRaw<WorkspaceSummary[]>`
      SELECT slug, name FROM auth_workspaces_for_email(${dto.email})
    `;
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    // Login is tenant-scoped: the lookup runs inside the request's
    // tenant transaction, so User's RLS policy resolves it through
    // Membership and a user who isn't a member of *this* workspace is
    // simply not found. That closes a gap where the API would mint a
    // valid token for a tenant the user had no access to and leave
    // /auth/me to reject it afterwards.
    const tx = this.cls.get('tenantTx');
    if (!tx) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await tx.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Login never goes through JwtAuthGuard (there's no token yet), so
    // nothing else would populate cls.userId — set it here so the audit
    // interceptor's generic auth.login entry records who logged in rather
    // than an anonymous actor.
    this.cls.set('userId', user.id);
    return { accessToken: this.jwt.sign({ sub: user.id }) };
  }

  /**
   * Redeeming an invite runs at whatever host the link was shared on —
   * almost always the root domain, never the target tenant's own
   * subdomain, since the whole point is the recipient doesn't have one
   * yet — so there is no tenant context here any more than there is at
   * signup. invite_lookup_by_code() is the SECURITY DEFINER function
   * that makes that lookup possible at all; see the add_invites
   * migration for the full reasoning (same shape as auth_email_exists /
   * auth_workspaces_for_email).
   */
  private async lookupInvite(code: string): Promise<InviteLookupRow | null> {
    const rows = await this.prisma.$queryRaw<InviteLookupRow[]>`
      SELECT * FROM invite_lookup_by_code(${code})
    `;
    return rows[0] ?? null;
  }

  /** What the join page shows before the visitor has typed anything —
   * see InviteInfo's own doc comment for why this reports *why* an
   * invite isn't usable rather than a single pass/fail bit. */
  async getInviteInfo(code: string): Promise<InviteInfo> {
    const invite = await this.lookupInvite(code);
    if (!invite) {
      throw new NotFoundException('This invite link is not valid');
    }
    const expired = invite.expires_at.getTime() <= Date.now();
    const used = invite.used_at !== null;
    return {
      tenantName: invite.tenant_name,
      tenantSlug: invite.tenant_slug,
      role: invite.role,
      valid: !expired && !used,
      expired,
      used,
    };
  }

  async acceptInvite(dto: AcceptInviteDto): Promise<SignupResponse> {
    const invite = await this.lookupInvite(dto.code);
    if (!invite) {
      throw new NotFoundException('This invite link is not valid');
    }
    // Friendly, fast-fail checks — not the actual one-time-use guarantee.
    // Two concurrent redemptions of the same code both pass these (classic
    // TOCTOU), which is exactly why the transaction below re-checks with
    // an atomic conditional update rather than trusting this.
    if (invite.used_at) {
      throw new ConflictException('This invite has already been used');
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      throw new ConflictException('This invite has expired');
    }

    const [{ exists }] = await this.prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT auth_email_exists(${dto.email}) AS exists
    `;
    if (exists) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const userId = randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
        // Joining an *existing* tenant, so unlike signup there's no
        // chicken-and-egg about the id — invite.tenant_id already names
        // a real row. Setting context to it is what makes every write
        // below (Membership, the Invite update, the audit row) pass
        // their own tenant_isolation policies.
        await setTenantContext(tx, invite.tenant_id);

        // Same raw INSERT-without-RETURNING as signup, and the same
        // reason: this user has no Membership yet, so User's
        // membership-gated SELECT policy would hide the row from a
        // normal tx.user.create()'s implicit RETURNING.
        await tx.$executeRaw`
          INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt")
          VALUES (${userId}, ${dto.email}, ${passwordHash}, ${dto.name}, now(), now())
        `;

        await tx.membership.create({
          data: { tenantId: invite.tenant_id, userId, role: invite.role },
        });

        // The real one-time-use enforcement: an unconditional update
        // would happily "succeed" a second time and just overwrite
        // usedAt/usedById, silently letting the same code mint a second
        // membership. Scoping the WHERE to usedAt: null makes a second
        // concurrent redemption affect 0 rows — caught below and rolled
        // back, undoing the User/Membership rows this same transaction
        // just inserted.
        const updated = await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null },
          data: { usedAt: new Date(), usedById: userId },
        });
        if (updated.count === 0) {
          throw new ConflictException('This invite has already been used');
        }

        // Same reasoning as signup's manual audit.signup row: no
        // tenantTx existed before this request (no tenant was resolved
        // going in), so AuditInterceptor never had a transaction to
        // write through. Recorded directly, now that one exists.
        await tx.auditEvent.create({
          data: {
            tenantId: invite.tenant_id,
            actorUserId: userId,
            action: 'auth.acceptInvite',
            targetType: 'Invite',
            targetId: invite.id,
            method: 'POST',
            path: '/auth/accept-invite',
            statusCode: 201,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }

    return {
      accessToken: this.jwt.sign({ sub: userId }),
      tenantId: invite.tenant_id,
      tenantSlug: invite.tenant_slug,
    };
  }
}
