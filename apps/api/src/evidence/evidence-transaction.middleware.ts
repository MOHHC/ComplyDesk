import { Injectable } from '@nestjs/common';
import { TenantTransactionMiddleware } from '../common/tenant-transaction.middleware';

/**
 * Same tenant-scoped transaction as every other route (see
 * TenantTransactionMiddleware) but with a longer `timeout`, wired in
 * AppModule.configure() for POST /controls/:controlId/evidence only.
 *
 * EvidenceService.upload() makes one classifyEvidence() call inline
 * before the transaction commits (see GeminiAiProvider). Before this
 * route was ever exercised against the real Gemini API (every prior
 * test used FakeAiProvider, which resolves instantly), the plain 15s
 * default was assumed to be enough. It wasn't, and neither was this
 * middleware's second revision (30s): a real image evidence upload
 * through the actual web UI came back with classification: null, traced
 * to GeminiAiProvider.CLASSIFICATION_TIMEOUT_MS (20s at the time)
 * aborting a real image classification call that was never separately
 * measured — vision input turned out to need a genuinely different
 * budget than text, not just more variance around the same number (see
 * that constant's own comment for the full measurement). This
 * transaction has to cover the worse of the two paths, so its own
 * budget follows GeminiAiProvider.IMAGE_CLASSIFICATION_TIMEOUT_MS (90s)
 * plus real margin for the surrounding control lookup and the two
 * inserts (evidence, then its classification row), rather than sitting
 * right at the edge of it and occasionally rolling back an upload that
 * had already succeeded in every way except the annotation on top of
 * it. A plain-text evidence upload still finishes in a few seconds —
 * this is a ceiling the transaction is allowed to use, not a floor it
 * has to wait out.
 *
 * `maxWait` is left at the inherited default, same reasoning as
 * GapAnalysisTransactionMiddleware: nothing about this route makes
 * connection acquisition slower than any other route.
 */
@Injectable()
export class EvidenceTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 110000, maxWait: 10000 };
}
