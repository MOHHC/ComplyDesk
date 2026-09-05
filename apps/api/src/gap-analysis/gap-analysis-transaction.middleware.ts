import { Injectable } from '@nestjs/common';
import { TenantTransactionMiddleware } from '../common/tenant-transaction.middleware';

/**
 * Same tenant-scoped transaction as every other route (see
 * TenantTransactionMiddleware) but with a longer `timeout`, wired in
 * AppModule.configure() for POST /gap-analysis/run only.
 *
 * GapAnalysisService.run() makes up to 18 controls' worth of
 * checkControlCoverage() calls through a 4-worker pool (see
 * runWithConcurrency). embed() is a local/bundled model call and fast;
 * checkControlCoverage() is the real Gemini API round trip and, on the
 * free tier, is paced by GeminiAiProvider's shared rate pacer (a fixed
 * minimum interval between calls — see MIN_CALL_INTERVAL_MS in
 * gemini-ai-provider.service.ts, sized to the free tier's *confirmed*
 * 5 requests/minute ceiling for gemini-3.6-flash, read off a live 429's
 * quota error, not the ~10-15/min figure this was originally guessed
 * at) rather than fired as fast as the worker pool allows. That pacing
 * floor dominates the run's total time: at the pacer's 4 RPM (15s
 * between calls, deliberately under the confirmed 5/min ceiling — see
 * that file for why), 18 calls have ~17 gaps between them regardless of
 * worker concurrency, since the pacer serializes every real call
 * process-wide — ~17 x 15s = ~255s just in pacing waits, before any
 * call's own latency or the surrounding DB work. 300s gives that
 * realistic floor real margin (occasional slow calls, one retry, DB
 * overhead) rather than sitting right at the edge of it.
 *
 * This is a real, deliberate tradeoff: a full 18-control run on the free
 * tier now takes on the order of 4-5 minutes wall-clock, holding this
 * transaction's connection open the whole time. That's acceptable for
 * manual/dev testing against a free API key; a production deployment
 * fronting a paid tier (no pacer needed, or a much higher one) or
 * wanting sub-minute runs would want this moved off the request/response
 * cycle entirely (a background job + polling), not just a bigger
 * transaction timeout.
 *
 * `maxWait` (time waiting for a pooled connection before the
 * transaction starts) is left at the inherited default — nothing about
 * this route makes connection acquisition slower than any other route.
 */
@Injectable()
export class GapAnalysisTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 300000, maxWait: 10000 };
}
