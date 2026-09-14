import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WorkspaceLookupThrottleGuard } from './workspace-lookup-throttle.guard';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { FindWorkspacesDto } from './dto/find-workspaces.dto';
import { AppClsStore } from '../common/cls-keys';
import { Audit } from '../audit/audit.decorator';
import { SkipAudit } from '../audit/skip-audit.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post('login')
  @Audit({ action: 'auth.login' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * POST rather than GET despite being a pure lookup: the email belongs
   * in a request body, not a URL, where it would land in server access
   * logs, browser history, and Referer headers. @SkipAudit for the same
   * reason — auditing it would write that email into whichever tenant's
   * audit trail the caller happened to resolve.
   *
   * 200 rather than Nest's POST default of 201: nothing is created.
   */
  @Post('workspaces')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceLookupThrottleGuard)
  @SkipAudit()
  findWorkspaces(@Body() dto: FindWorkspacesDto) {
    return this.auth.findWorkspaces(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me() {
    return {
      tenantId: this.cls.get('tenantId'),
      userId: this.cls.get('userId'),
      role: this.cls.get('role'),
      isDemoTenant: this.cls.get('isDemoTenant') ?? false,
    };
  }
}
