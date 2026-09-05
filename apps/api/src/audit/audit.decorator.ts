import { SetMetadata } from '@nestjs/common';

export interface AuditOptions {
  /** Dot-namespaced label recorded verbatim, e.g. "evidence.upload". */
  action: string;
  /** Prisma delegate name (lowercase) to read a before/after diff from,
   * e.g. "task", "evidence". Omit for actions with no natural row to
   * diff (auth.login) — those get a generic entry instead. */
  model?: 'task' | 'evidence' | 'control' | 'membership' | 'evidenceClassification';
  /** Route param holding the target's id, for reading the "before" state
   * ahead of the handler running. Defaults to "id". Irrelevant for
   * creates, which have no id until the handler returns one. */
  idParam?: string;
}

export const AUDIT_KEY = 'audit';

export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
