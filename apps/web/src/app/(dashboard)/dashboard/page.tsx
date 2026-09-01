'use client';

import { useEffect, useState } from 'react';
import type { ReadinessSummary } from '@complydesk/shared';
import { Notice } from '@/components/ui';
import { useAuth } from '@/lib/useAuth';
import { getReadiness } from '@/lib/api';

/**
 * Deliberately not a grid of stat cards. This is a control summary
 * sheet: one dominant figure, a proportion bar, and three ruled ledger
 * rows carrying the states a control can actually be in. Each row is
 * marked in the left gutter with its status ink — the same gutter the
 * nav uses for "you are here" — so state is read in one column.
 */

type Tone = 'verified' | 'expiring' | 'exception';

const TONE_RULE: Record<Tone, string> = {
  verified: 'border-l-verified',
  expiring: 'border-l-expiring',
  exception: 'border-l-exception',
};

const TONE_TEXT: Record<Tone, string> = {
  verified: 'text-verified',
  expiring: 'text-expiring',
  exception: 'text-exception',
};

function LedgerRow({
  tone,
  count,
  label,
  note,
}: {
  tone: Tone;
  count: number;
  label: string;
  note: string;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 border-b border-l-2 border-rule ${TONE_RULE[tone]} py-3.5 pr-1 pl-4`}
    >
      <span className={`tabular font-mono text-[17px] font-medium ${TONE_TEXT[tone]} w-9 shrink-0`}>
        {count}
      </span>
      <span className="flex-1 text-[14px] font-medium text-ink">{label}</span>
      <span className="hidden text-[13px] text-ink-muted sm:block">{note}</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 border-b border-l-2 border-rule border-l-transparent py-3.5 pr-1 pl-4">
      <span className="h-4 w-9 shrink-0 rounded-sm bg-rule/70" />
      <span className="h-4 flex-1 rounded-sm bg-rule/50" />
    </div>
  );
}

export default function DashboardPage() {
  const { token, ready } = useAuth();
  const [summary, setSummary] = useState<ReadinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getReadiness(token)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, [token]);

  if (!ready) return null;

  const evidenced = summary ? summary.totalControls - summary.controlsMissingEvidence : 0;

  return (
    <div>
      <header className="mb-8 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Readiness</h1>
        <span className="font-mono text-[11px] text-ink-muted">
          {summary ? `${summary.totalControls} controls` : '—'}
        </span>
      </header>

      {error && <Notice>{error}</Notice>}

      {!error && (
        <>
          <section aria-label="Overall readiness" className="mb-9">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="tabular font-mono text-[52px] leading-none font-medium tracking-[-0.02em] text-ink">
                  {summary ? `${summary.controlsWithValidEvidencePercent}%` : '—'}
                </div>
                <p className="mt-2.5 text-[13px] text-ink-muted">
                  {summary
                    ? `${evidenced} of ${summary.totalControls} controls have current evidence`
                    : 'Loading readiness…'}
                </p>
              </div>
            </div>

            {/* Proportion bar, not a decorative chart: its fill is exactly
                the percentage above, in the same ink that marks a
                verified control. */}
            <div
              className="mt-5 h-1.5 w-full overflow-hidden rounded-sm bg-rule"
              role="img"
              aria-label={
                summary
                  ? `${summary.controlsWithValidEvidencePercent}% of controls have current evidence`
                  : 'Readiness loading'
              }
            >
              <div
                className="h-full bg-verified transition-[width] duration-500 ease-out"
                style={{ width: `${summary?.controlsWithValidEvidencePercent ?? 0}%` }}
              />
            </div>
          </section>

          <section aria-label="Control states">
            <h2 className="mb-2 text-[13px] font-medium text-ink-muted">By evidence state</h2>
            <div className="border-t border-rule">
              {summary ? (
                <>
                  <LedgerRow
                    tone="verified"
                    count={summary.totalControls - summary.controlsMissingEvidence}
                    label="Evidence current"
                    note="Within its refresh interval"
                  />
                  <LedgerRow
                    tone="expiring"
                    count={summary.evidenceExpiringSoon}
                    label="Expiring within 30 days"
                    note="Collect refreshed evidence"
                  />
                  <LedgerRow
                    tone="exception"
                    count={summary.controlsMissingEvidence}
                    label="Missing evidence"
                    note="No evidence on file"
                  />
                </>
              ) : (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
