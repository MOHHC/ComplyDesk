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
 * middleware's own first revision (20s): live testing against
 * gemini-3.6-flash showed real round trips ranging from ~9s up to a
 * genuine timeout past 12s for the same prompt, so
 * GeminiAiProvider.CLASSIFICATION_TIMEOUT_MS was raised to 20s to cover
 * that variance — which means this transaction needs real headroom
 * above 20s, not just above whatever the call timeout used to be.
 * 30s gives that call room plus the surrounding control lookup and the
 * two inserts (evidence, then its classification row), rather than
 * sitting right at the edge of it and occasionally rolling back an
 * upload that had already succeeded in every way except the annotation
 * on top of it.
 *
 * `maxWait` is left at the inherited default, same reasoning as
 * GapAnalysisTransactionMiddleware: nothing about this route makes
 * connection acquisition slower than any other route.
 */
@Injectable()
export class EvidenceTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 30000, maxWait: 10000 };
}
