'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GapAnalysisReport } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { getLatestGapAnalysis, runGapAnalysis } from '@/lib/api';
import { Badge, Button, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader } from '@/components/register';

// @Roles(OWNER, ADMIN) on POST /gap-analysis/run — same boundary as
// every gated action on this page, hidden client-side as a UX nicety.
const CAN_RUN = new Set(['OWNER', 'ADMIN']);

export default function GapAnalysisPage() {
  const { token, me, ready } = useAuth();
  const [report, setReport] = useState<GapAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    getLatestGapAnalysis(token)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the latest report'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRun() {
    if (!token) return;
    setRunning(true);
    setError(null);
    try {
      const result = await runGapAnalysis(token);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap analysis run failed');
    } finally {
      setRunning(false);
    }
  }

  const sortedResults = useMemo(
    () => (report ? [...report.results].sort((a, b) => a.control.code.localeCompare(b.control.code)) : []),
    [report],
  );

  if (!ready) return null;

  const coveredCount = report?.results.filter((r) => r.covered).length ?? 0;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Gap analysis</h1>
        {report && (
          <span className="tabular font-mono text-[11px] text-ink-muted">
            {new Date(report.createdAt).toLocaleString()}
          </span>
        )}
      </header>

      {error && <Notice>{error}</Notice>}

      {me && CAN_RUN.has(me.role) && (
        <div className="mb-8 border-b border-rule pb-6">
          <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
            Checks every control against the uploaded policy documents. This can take a while — each control is
            checked individually against the policy library.
          </p>
          <Button type="button" onClick={handleRun} disabled={running} className="w-auto">
            {running ? 'Running gap analysis…' : 'Run gap analysis'}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-ink-muted">Loading the latest report…</p>
      ) : !report ? (
        <RegisterEmpty>No gap analysis has been run yet.</RegisterEmpty>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-ink-muted">
            <span className="tabular font-mono text-ink">{coveredCount}</span> of{' '}
            <span className="tabular font-mono text-ink">{report.results.length}</span> controls covered by an
            uploaded policy.
          </p>
          <RegisterHeader columns={['Control', 'Status', 'Reasoning & citation']} />
          {sortedResults.map((result) => (
            <div key={result.id} className="flex gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <div className="flex-[1.4] min-w-0">
                <span className="block font-mono text-[12px] text-ink-muted">{result.control.code}</span>
                <span className="block truncate text-[14px] font-medium text-ink">{result.control.title}</span>
              </div>
              <div className="flex-1">
                <Badge tone={result.covered ? 'verified' : 'exception'}>
                  {result.covered ? 'Covered' : 'Not covered'}
                </Badge>
              </div>
              <div className="flex-1">
                <p className="text-[13px] leading-relaxed text-ink-muted">{result.reasoning}</p>
                {result.citationChunk && (
                  <p className="mt-1.5 border-l-2 border-l-rule pl-2 text-[12px] text-ink-muted">
                    Citation:{' '}
                    <span className="font-medium text-ink">{result.citationChunk.document.fileName}</span>{' '}
                    <span className="tabular font-mono">(chunk {result.citationChunk.chunkIndex})</span>
                    <br />
                    <span className="italic">&ldquo;{result.citationChunk.content.slice(0, 160)}
                      {result.citationChunk.content.length > 160 ? '…' : ''}&rdquo;</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
