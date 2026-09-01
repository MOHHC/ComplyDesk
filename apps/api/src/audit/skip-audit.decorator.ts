import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';

/**
 * Excludes a route from the global AuditInterceptor.
 *
 * Reserved for routes that are POSTs for request-shape reasons rather
 * than because they mutate anything — e.g. a lookup that takes an email
 * in the body specifically to keep it out of URLs and server logs.
 * Auditing those would write the very PII the POST was chosen to avoid
 * logging, into whichever tenant's audit trail the caller happened to
 * resolve. Never use this to hide an actual mutation.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
