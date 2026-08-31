import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Role } from '@prisma/client';
import { AppClsStore } from '../common/cls-keys';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on this route: any authenticated member passes.
    // JwtAuthGuard (which must run first) already confirmed membership.
    if (!required || required.length === 0) {
      return true;
    }

    const role = this.cls.get('role');
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Your role does not permit this action');
    }
    return true;
  }
}
