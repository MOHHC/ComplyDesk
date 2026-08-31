import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from './cls-keys';
import { parseSubdomain } from './subdomain';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const subdomain = parseSubdomain(req.headers.host);
    if (subdomain) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: subdomain },
      });
      if (tenant) {
        this.cls.set('tenantId', tenant.id);
      }
    }
    next();
  }
}
