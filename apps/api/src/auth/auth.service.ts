import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { setTenantContext } from '../common/set-tenant-context';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto): Promise<{ accessToken: string }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (existingTenant) {
      throw new ConflictException('This workspace URL is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName, slug: dto.tenantSlug },
      });
      // Membership is RLS-protected and this INSERT's row is checked
      // against app.tenant_id (WITH CHECK) same as any other write to
      // it. There's no pre-existing tenant context to inherit here —
      // the tenant is being created in this same transaction — so set
      // it explicitly now that the tenant's id exists.
      await setTenantContext(tx, tenant.id);
      const createdUser = await tx.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: createdUser.id, role: 'OWNER' },
      });
      return createdUser;
    });

    return { accessToken: this.jwt.sign({ sub: user.id }) };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
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
