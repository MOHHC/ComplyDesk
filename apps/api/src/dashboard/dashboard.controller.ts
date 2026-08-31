import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { DashboardService } from './dashboard.service';

// No @Roles(): the readiness summary is view-only data, available to
// every membership role including AUDITOR.
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('readiness')
  readiness() {
    return this.dashboard.readiness();
  }
}
