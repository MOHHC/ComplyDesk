import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from './cls-keys';
import { parseSubdomain } from './subdomain';

const TENANT_HEADER = 'x-tenant-slug';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const slug =
      parseSubdomain(req.headers.host) ??
      this.extractHeaderSlug(req.headers[TENANT_HEADER]);

    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug },
      });
      if (tenant) {
        this.cls.set('tenantId', tenant.id);
      }
    }
    next();
  }

  /**
   * Browsers never let JS override the Host header on fetch/XHR, so a
   * browser-based client can't communicate its tenant via Host the way
   * curl or a server-to-server caller can. The web app sends its own
   * subdomain via X-Tenant-Slug instead. Host-based resolution above
   * always wins when it resolves a tenant — this header is purely a
   * fallback for callers that can't control Host, not a way to override it.
   */
  private extractHeaderSlug(header: string | string[] | undefined): string | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
  }
}
