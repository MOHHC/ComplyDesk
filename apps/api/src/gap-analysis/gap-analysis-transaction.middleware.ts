import { Injectable } from '@nestjs/common';
import { TenantTransactionMiddleware } from '../common/tenant-transaction.middleware';

/**
 * Same tenant-scoped transaction as every other route (see
 * TenantTransactionMiddleware) but with a longer `timeout`, wired in
 * AppModule.configure() for POST /gap-analysis/run only.
 *
 * GapAnalysisService.run() makes up to 18 controls' worth of sequential
 * AI calls, batched at concurrency 4 (~5 rounds through the worker pool
 * — see runWithConcurrency). embed() is a local/bundled model call and
 * fast; checkControlCoverage() is the real Claude API round trip and
 * dominates each round's latency. Budgeting generously for API variance
 * (~15s/call, including occasional slow responses) across ~5 rounds
 * gives ~75s of realistic worst-case work, so the timeout is set above
 * that with headroom rather than at the plain-CRUD default of 15s,
 * which this route would otherwise blow through on any real Claude
 * latency and roll back an in-progress run.
 *
 * `maxWait` (time waiting for a pooled connection before the
 * transaction starts) is left at the inherited default — nothing about
 * this route makes connection acquisition slower than any other route.
 */
@Injectable()
export class GapAnalysisTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 75000, maxWait: 10000 };
}
