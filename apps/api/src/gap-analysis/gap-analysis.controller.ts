import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { TenantRateLimitGuard } from '../rate-limit/tenant-rate-limit.guard';
import { DemoReadOnlyGuard } from '../common/demo-tenant.guard';
import { Audit } from '../audit/audit.decorator';
import { GapAnalysisService } from './gap-analysis.service';

@Controller('gap-analysis')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRateLimitGuard)
export class GapAnalysisController {
  constructor(private readonly gapAnalysis: GapAnalysisService) {}

  @Post('run')
  @Roles(Role.OWNER, Role.ADMIN)
  @UseGuards(DemoReadOnlyGuard)
  @RateLimit('gapAnalysis')
  @Audit({ action: 'gapanalysis.run' })
  run() {
    return this.gapAnalysis.run();
  }

  @Get('latest')
  latest() {
    return this.gapAnalysis.latest();
  }
}
