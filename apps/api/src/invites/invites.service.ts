import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';

// 32 random bytes, base64url-encoded (~43 chars, URL-safe with no
// padding) — the code itself is the secret an invite is redeemed with,
// not a lookup key alongside one, so it needs real entropy rather than a
// short/sequential id. See invite_lookup_by_code() in the add_invites
// migration for why that's what makes the pre-auth redemption lookup
// safe to leave keyed on this column directly instead of needing its own
// separate secret.
const CODE_BYTES = 32;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — "basic" expiry, not configurable per invite yet

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async create(role: Role) {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    const userId = this.cls.get('userId')!;
    const code = randomBytes(CODE_BYTES).toString('base64url');

    return tx.invite.create({
      data: {
        tenantId,
        code,
        role,
        createdById: userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  }

  /** Outstanding invites for the Team page's "pending invites" list —
   * not yet redeemed, not yet expired. Used/expired invites remain real
   * rows (the audit trail of who invited whom, and whether it was ever
   * taken up), just not something worth showing every time an admin
   * opens this page. */
  async listPending() {
    const tx = this.tx();
    return tx.invite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
