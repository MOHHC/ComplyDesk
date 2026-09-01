import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../common/cls-keys';
import { RATE_LIMIT_KEY, RateLimitName } from './rate-limit.decorator';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMITS: Record<RateLimitName, number> = {
  classification: 30,
  gapAnalysis: 5,
};
const MAX_TRACKED_KEYS = 10_000;

/**
 * Per-tenant fixed-window limit on the two Claude-calling routes.
 * In-memory/per-process — same documented, accepted limitation as
 * WorkspaceLookupThrottleGuard (doesn't hold across a multi-instance
 * deployment; Redis is the future fix, not built now).
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name) return true;

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return true; // shouldn't happen behind JwtAuthGuard; RLS still protects data either way

    const key = `${name}:${tenantId}`;
    const now = Date.now();
    this.pruneIfNeeded(now);

    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    if (entry.count > LIMITS[name]) {
      throw new HttpException(
        `Too many ${name} requests for this workspace. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private pruneIfNeeded(now: number): void {
    if (this.hits.size < MAX_TRACKED_KEYS) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= WINDOW_MS) this.hits.delete(key);
    }
  }
}
