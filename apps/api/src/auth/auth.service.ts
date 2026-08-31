import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { setTenantContext } from '../common/set-tenant-context';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

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
  ) {}

  async signup(dto: SignupDto): Promise<{ accessToken: string }> {
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

    return { accessToken: this.jwt.sign({ sub: userId }) };
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
    return { accessToken: this.jwt.sign({ sub: user.id }) };
  }
}
