import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from './cls-keys';
import { setTenantContext } from './set-tenant-context';

/**
 * Opens one Prisma transaction spanning the rest of this request —
 * guards, interceptors, and the handler — and stashes it in cls as
 * `tenantTx` so anything touching an RLS-protected table (Membership,
 * Control, Evidence, Task) queries through it instead of the plain
 * PrismaService. It has to run as middleware (before guards), not an
 * interceptor (which only wraps guards-onward), because JwtAuthGuard
 * itself queries Membership to check role.
 *
 * Registered in AppModule after TenantMiddleware, which is what
 * populates cls.tenantId in the first place.
 */
@Injectable()
export class TenantTransactionMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      // No tenant resolved for this request (e.g. signup, which creates
      // the tenant mid-request — see AuthService.signup, which sets
      // app.tenant_id itself inside its own transaction once the tenant
      // exists). Nothing to scope here; run as-is.
      next();
      return;
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await setTenantContext(tx, tenantId);
          this.cls.set('tenantTx', tx);

          await new Promise<void>((resolve, reject) => {
            res.once('finish', () => {
              if (res.statusCode >= 500) {
                reject(new Error(`Request failed with status ${res.statusCode}`));
              } else {
                resolve();
              }
            });
            res.once('error', reject);
            next();
          });
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (err) {
      // Prisma already rolled back the transaction at this point — that
      // is what actually matters for tenant isolation. If the response
      // hasn't gone out yet, this is a genuine unhandled error; if it
      // has, there's nothing left to do but let it be logged upstream.
      if (!res.headersSent) {
        next(err as Error);
      }
    }
  }
}
