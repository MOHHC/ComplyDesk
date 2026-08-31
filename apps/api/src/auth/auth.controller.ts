import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AppClsStore } from '../common/cls-keys';

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
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me() {
    return {
      tenantId: this.cls.get('tenantId'),
      userId: this.cls.get('userId'),
      role: this.cls.get('role'),
    };
  }
}
