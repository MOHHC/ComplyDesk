import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from './cls-keys';
import { parseSubdomain } from './subdomain';

const TENANT_HEADER = 'x-tenant-slug';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  // The domain real tenant subdomains actually live under — derived from
  // WEB_ORIGIN, the same value CORS already trusts subdomains of (see
  // configure-app.ts). Host-based resolution below is only trusted when
  // the request's own Host is that domain or a subdomain of it; anything
  // else falls through to the X-Tenant-Slug header instead.
  //
  // This exists because of a real bug: the API's own deployed hostname
  // (e.g. complydesk-api.onrender.com) has exactly the same shape as a
  // genuine tenant subdomain — three dot-separated labels — so
  // parseSubdomain("complydesk-api.onrender.com") happily, wrongly,
  // returns "complydesk-api" as if it were a tenant slug. Host
  // resolution "succeeding" on that garbage value then shadowed the
  // X-Tenant-Slug header the web app was sending correctly, on every
  // single request the deployed frontend made to the deployed API —
  // discovered by an actual end-to-end signup against the live stack,
  // not a review of the code in isolation.
  private readonly trustedRootHost: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    this.trustedRootHost = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000').hostname;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const hostSlug = this.isHostTrusted(req.headers.host) ? parseSubdomain(req.headers.host) : null;
    const slug = hostSlug ?? this.extractHeaderSlug(req.headers[TENANT_HEADER]);

    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug },
      });
      if (tenant) {
        this.cls.set('tenantId', tenant.id);
        this.cls.set('isDemoTenant', tenant.isDemo);
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

  /** Localhost (and *.localhost, for `acme.localhost:3000` dev/test
   * hosts) is always trusted regardless of WEB_ORIGIN, matching
   * parseSubdomain's own dev-mode handling. Everything else must be the
   * configured root domain or a subdomain of it. */
  private isHostTrusted(host: string | undefined): boolean {
    if (!host) return false;
    const hostname = host.split(':')[0].toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    return hostname === this.trustedRootHost || hostname.endsWith(`.${this.trustedRootHost}`);
  }
}
