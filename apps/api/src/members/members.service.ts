import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  /** Just enough to populate an assignee picker — not a user-management
   * endpoint. Membership's own tenant_isolation policy already scopes
   * this to the caller's workspace. */
  async list() {
    const tx = this.tx();
    const memberships = await tx.membership.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { role: 'asc' },
    });
    return memberships.map((m: (typeof memberships)[number]) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
  }
}
