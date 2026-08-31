import { Prisma } from '@prisma/client';

export type ControlStatus = 'no_evidence' | 'has_evidence' | 'evidence_expired';

export const CONTROL_STATUSES: ControlStatus[] = [
  'no_evidence',
  'has_evidence',
  'evidence_expired',
];

export const EXPIRING_SOON_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeControlStatus(
  refreshIntervalDays: number,
  latestCollectedAt: Date | null,
  now: Date = new Date(),
): ControlStatus {
  if (!latestCollectedAt) return 'no_evidence';
  const expiresAt = latestCollectedAt.getTime() + refreshIntervalDays * MS_PER_DAY;
  return expiresAt < now.getTime() ? 'evidence_expired' : 'has_evidence';
}

/** True for a control that currently has valid evidence, but whose
 * refresh window closes within EXPIRING_SOON_WINDOW_DAYS — a distinct,
 * narrower bucket than "evidence_expired" (which has already closed). */
export function isExpiringSoon(
  refreshIntervalDays: number,
  latestCollectedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!latestCollectedAt) return false;
  const expiresAt = latestCollectedAt.getTime() + refreshIntervalDays * MS_PER_DAY;
  const windowEnd = now.getTime() + EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY;
  return expiresAt >= now.getTime() && expiresAt <= windowEnd;
}

/**
 * Latest Evidence.collectedAt per control, in one query rather than one
 * per control. Prisma has no "latest row per group" primitive, but
 * groupBy's _max is exactly that for a single scalar column, and it runs
 * under the caller's tenant-scoped transaction, so RLS filters it exactly
 * like any other query — no risk of aggregating across tenants.
 */
export async function getLatestEvidenceMap(
  tx: Prisma.TransactionClient | { evidence: { groupBy: (...args: any[]) => Promise<any> } },
  controlIds: string[],
): Promise<Map<string, Date>> {
  if (controlIds.length === 0) return new Map();
  const grouped = await (tx as any).evidence.groupBy({
    by: ['controlId'],
    where: { controlId: { in: controlIds } },
    _max: { collectedAt: true },
  });
  return new Map(
    grouped
      .filter((g: any) => g._max.collectedAt)
      .map((g: any) => [g.controlId, g._max.collectedAt as Date]),
  );
}
