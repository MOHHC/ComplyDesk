import { Injectable } from '@nestjs/common';
import { TenantTransactionMiddleware } from '../common/tenant-transaction.middleware';

/**
 * Same tenant-scoped transaction as every other route (see
 * TenantTransactionMiddleware) but with a longer `timeout`, wired in
 * AppModule.configure() for POST /policy-documents only.
 *
 * PolicyDocumentsService.upload() runs a sequential per-chunk loop: a
 * local (in-process, no network) embedding-model inference call plus a
 * raw-SQL insert, for every chunk the uploaded file produces. The route
 * accepts files up to 25MB (MAX_FILE_SIZE_BYTES in
 * policy-documents.controller.ts), and there is no cap on chunk count —
 * a dense ~100-page PDF is roughly 500 chunks at the ~800-token chunk
 * size chunk-text.ts uses. Budgeting generously per chunk (~200ms,
 * covering slower cold-start inference and DB round trips under load)
 * across ~500 chunks gives ~100s of realistic worst-case work, so the
 * timeout is set above that with headroom rather than at the
 * plain-CRUD default of 15s, which this route would otherwise blow
 * through on any sizeable document and roll back the *entire* upload
 * after doing all the extraction/embedding work.
 *
 * `maxWait` is left at the inherited default, same reasoning as
 * GapAnalysisTransactionMiddleware: nothing about this route makes
 * connection acquisition slower than any other route.
 */
@Injectable()
export class PolicyDocumentsTransactionMiddleware extends TenantTransactionMiddleware {
  protected readonly transactionOptions = { timeout: 120000, maxWait: 10000 };
}
