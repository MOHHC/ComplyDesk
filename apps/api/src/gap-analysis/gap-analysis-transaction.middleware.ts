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
 * checkControlCoverage() is now GroqAiProvider's API round trip (moved
 * off Gemini — see that file's own comment for why), paced by its own
 * shared rate pacer at 24 RPM (2.5s between calls — see
 * GROQ_FREE_TIER_RPM in groq-ai-provider.service.ts) rather than fired
 * as fast as the worker pool allows.
 *
 * This budget used to be 300s: Gemini's confirmed 4 RPM pacer meant ~17
 * gaps between 18 calls at 15s each — ~255s just in pacing waits, before
 * any call's own latency. Groq's pacer is an order of magnitude faster
 * (2.5s vs 15s between calls), so that floor is theoretically only
 * ~17 x 2.5s = ~42.5s — and a real 18-control run against a real policy
 * document (openai/gpt-oss-120b, GROQ_API_KEY, chunkCount > 0 so every
 * control actually made a live checkControlCoverage call, not the empty-
 * policy-library fast path) measured the whole request at ~49s
 * wall-clock end to end, zero 429s. 90s, not 60s: 49s measured against a
 * ~42.5s theoretical floor already shows the model's own per-call
 * latency adds real time beyond pure pacing, and 60s (the first guess,
 * made before this was ever measured) would have left only ~11s of
 * margin over that single real data point — the same mistake
 * GeminiAiProvider's classification timeout made at first, sized before
 * a real measurement existed. 90s keeps closer to a real 2x margin
 * instead.
 *
 * `maxWait` (time waiting for a pooled connection before the
 * transaction starts) is left at the inherited default — nothing about
 * this route makes connection acquisition slower than any other route.
 */
@Injectable()
export class GapAnalysisTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 90000, maxWait: 10000 };
}
