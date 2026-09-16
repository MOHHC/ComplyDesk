import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WorkspaceLookupThrottleGuard } from './workspace-lookup-throttle.guard';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { FindWorkspacesDto } from './dto/find-workspaces.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
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

  /**
   * Pre-auth, by design: this is exactly what the join page needs to
   * render "You've been invited to <tenant> as <role>" before anyone has
   * typed anything. The code itself is the only thing gating access to
   * this — a 32-random-byte token, not something worth rate-limiting the
   * same way the email-based workspace lookup is (that one enumerates a
   * small keyspace of real emails; guessing a valid invite code isn't
   * practically feasible).
   */
  @Get('invites/:code')
  @SkipAudit()
  getInviteInfo(@Param('code') code: string) {
    return this.auth.getInviteInfo(code);
  }

  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(dto);
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
