import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { DemoReadOnlyGuard } from '../common/demo-tenant.guard';
import { Audit } from '../audit/audit.decorator';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@Controller('invites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // Blocked on the demo tenant: redeeming an invite hands the redeemer a
  // real Membership row (potentially OWNER/ADMIN) in a tenant every
  // visitor shares — unlike the AI-cost actions DemoReadOnlyGuard
  // otherwise exists for, this one is a real access-control concern, not
  // just narrative-preservation.
  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  @UseGuards(DemoReadOnlyGuard)
  @Audit({ action: 'invite.create' })
  create(@Body() dto: CreateInviteDto) {
    return this.invites.create(dto.role);
  }

  @Get()
  @Roles(Role.OWNER, Role.ADMIN)
  list() {
    return this.invites.listPending();
  }
}
