'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Control, ControlStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listControls } from '@/lib/api';

const STATUS_LABEL: Record<ControlStatus, string> = {
  no_evidence: 'No evidence',
  has_evidence: 'Has evidence',
  evidence_expired: 'Evidence expired',
};

const STATUS_COLOR: Record<ControlStatus, string> = {
  no_evidence: '#999',
  has_evidence: '#1a7f37',
  evidence_expired: '#cf222e',
};

export default function ControlsPage() {
  const { token, ready } = useAuth();
  const [controls, setControls] = useState<Control[]>([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ControlStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listControls(token, {
      category: category || undefined,
      status: status || undefined,
    })
      .then(setControls)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load controls'))
      .finally(() => setLoading(false));
  }, [token, category, status]);

  const categories = useMemo(
    () => Array.from(new Set(controls.map((c) => c.category))).sort(),
    [controls],
  );

  if (!ready) return null;

  return (
    <div>
      <h1>Controls</h1>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <label>
          Category{' '}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status{' '}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ControlStatus | '')}
          >
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as ControlStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e2e2' }}>
              <th>Code</th>
              <th>Title</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {controls.map((control) => (
              <tr key={control.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td>
                  <Link href={`/controls/${control.id}`}>{control.code}</Link>
                </td>
                <td>{control.title}</td>
                <td>{control.category}</td>
                <td style={{ color: STATUS_COLOR[control.status] }}>
                  {STATUS_LABEL[control.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && controls.length === 0 && <p>No controls match this filter.</p>}
    </div>
  );
}
