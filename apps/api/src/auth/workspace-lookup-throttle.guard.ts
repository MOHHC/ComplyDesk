import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_TRACKED_CLIENTS = 10_000;

/**
 * Per-IP fixed-window limit on the workspace lookup, which is
 * unauthenticated and discloses whether an email is registered and which
 * organizations it belongs to. Rate limiting doesn't remove that
 * disclosure — it only makes bulk scraping impractical.
 *
 * In-memory and therefore per-process: it does not hold across a
 * multi-instance deployment, where this belongs in Redis or at the edge.
 * That's an accepted limit at this project's current single-process
 * scope, not an oversight — stated here so it isn't mistaken for a
 * complete defense later.
 */
@Injectable()
export class WorkspaceLookupThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();

    this.pruneIfNeeded(now);

    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    if (entry.count > MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        'Too many workspace lookups. Please try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Bounded memory: without this the map grows once per distinct client
   * IP forever, which is a slow leak an attacker can drive deliberately
   * by spoofing source addresses. */
  private pruneIfNeeded(now: number): void {
    if (this.hits.size < MAX_TRACKED_CLIENTS) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= WINDOW_MS) {
        this.hits.delete(key);
      }
    }
  }
}
