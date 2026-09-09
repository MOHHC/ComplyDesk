import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../common/cls-keys';
import { RATE_LIMIT_KEY, RateLimitName } from './rate-limit.decorator';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMITS: Record<RateLimitName, number> = {
  classification: 30,
  // Was 5 — sized around Gemini, which handled coverage checks before
  // GroqAiProvider took over (see that file). Gemini's confirmed
  // free-tier ceiling was ~5 requests/minute and ~20/day; a full
  // 18-control run cost most of an hour's worth of that budget on its
  // own, so 5 runs/hour/tenant was already close to the real ceiling,
  // not just a conservative throttle.
  //
  // Groq's free-tier limits for openai/gpt-oss-120b (the model actually
  // in use — see GroqAiProvider.COVERAGE_MODEL for why this isn't
  // llama-3.3-70b-versatile after all) are confirmed straight from
  // Groq's own rate-limits documentation, not a third-party tracker: 30
  // requests/minute, 1,000/day. A real 18-control gap-analysis run
  // against this project's own GROQ_API_KEY completed in ~49s with zero
  // 429s. At 18 requests/run, 1,000/day covers roughly 55 runs/day on
  // Groq's own ceiling alone. 20/hour/tenant is a 4x increase over the
  // old Gemini-sized value — a real loosening reflecting the new
  // provider's headroom — while still leaving room for more than one
  // tenant to run gap analysis in the same hour without one tenant alone
  // threatening the shared daily budget (this credential, like Gemini's,
  // is one project-wide key shared by every tenant, not a per-tenant
  // one).
  gapAnalysis: 20,
};
const MAX_TRACKED_KEYS = 10_000;

/**
 * Per-tenant fixed-window limit on the two AI-calling routes.
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

    if (!this.tryConsume(name, tenantId)) {
      throw new HttpException(
        `Too many ${name} requests for this workspace. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /**
   * Non-throwing variant of the same fixed-window check, for call sites
   * that must degrade rather than reject when the budget is spent — see
   * EvidenceService.upload, which must never fail the upload itself
   * just because the classification budget ran out. Returns false
   * (without consuming anything further) once the window's count is
   * already over the limit; true and increments the count otherwise.
   */
  tryConsume(name: RateLimitName, tenantId: string): boolean {
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
      return false;
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
