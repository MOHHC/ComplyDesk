'use client';

import { useEffect, useState } from 'react';
import type { ReadinessSummary } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { getReadiness } from '@/lib/api';

const TILE_STYLE: React.CSSProperties = {
  border: '1px solid #e2e2e2',
  borderRadius: 8,
  padding: '1.25rem',
  minWidth: 180,
};

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

  return (
    <div>
      <h1>Readiness</h1>
      {error && <p role="alert">{error}</p>}
      {!summary ? (
        <p>Loading…</p>
      ) : (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={TILE_STYLE}>
            <div style={{ fontSize: '2rem', fontWeight: 600 }}>
              {summary.controlsWithValidEvidencePercent}%
            </div>
            <div>Controls with valid evidence</div>
          </div>
          <div style={TILE_STYLE}>
            <div style={{ fontSize: '2rem', fontWeight: 600 }}>
              {summary.controlsMissingEvidence}
            </div>
            <div>Controls missing evidence</div>
          </div>
          <div style={TILE_STYLE}>
            <div style={{ fontSize: '2rem', fontWeight: 600 }}>{summary.evidenceExpiringSoon}</div>
            <div>Evidence expiring within 30 days</div>
          </div>
          <div style={TILE_STYLE}>
            <div style={{ fontSize: '2rem', fontWeight: 600 }}>{summary.totalControls}</div>
            <div>Total controls</div>
          </div>
        </div>
      )}
    </div>
  );
}
