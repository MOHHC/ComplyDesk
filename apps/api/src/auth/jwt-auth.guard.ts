import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('Unknown or missing tenant');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: payload.sub } },
    });
    if (!membership) {
      throw new ForbiddenException('No access to this workspace');
    }

    this.cls.set('userId', payload.sub);
    this.cls.set('role', membership.role);
    req.user = { id: payload.sub, role: membership.role };
    return true;
  }

  private extractToken(header: string | undefined): string | null {
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
