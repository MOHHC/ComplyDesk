'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Control, ControlStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listControls } from '@/lib/api';
import { Badge } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

const STATUS_LABEL: Record<ControlStatus, string> = {
  no_evidence: 'No evidence',
  has_evidence: 'Evidence on file',
  evidence_expired: 'Evidence expired',
};

const STATUS_TONE: Record<ControlStatus, 'verified' | 'expiring' | 'exception'> = {
  no_evidence: 'exception',
  has_evidence: 'verified',
  evidence_expired: 'expiring',
};

const STATUS_GUTTER: Record<ControlStatus, string> = {
  no_evidence: 'border-l-exception',
  has_evidence: 'border-l-verified',
  evidence_expired: 'border-l-expiring',
};

function ControlRow({ control }: { control: Control }) {
  return (
    <Link
      href={`/controls/${control.id}`}
      className={`flex items-center gap-4 border-b border-l-2 border-rule py-3.5 pr-1 pl-4 transition-colors duration-150 hover:bg-paper-raised ${STATUS_GUTTER[control.status]}`}
    >
      <span className="flex-[1.4] min-w-0">
        <span className="block font-mono text-[12px] text-ink-muted">{control.code}</span>
        <span className="block truncate text-[14px] font-medium text-ink">{control.title}</span>
      </span>
      <span className="flex-1 text-[13px] text-ink-muted">{control.category}</span>
      <span className="flex-1">
        <Badge tone={STATUS_TONE[control.status]}>{STATUS_LABEL[control.status]}</Badge>
      </span>
    </Link>
  );
}

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
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Controls</h1>
        <span className="font-mono text-[11px] text-ink-muted">
          {loading ? '—' : `${controls.length} shown`}
        </span>
      </header>

      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ControlStatus | '')}
          className="rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as ControlStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="mb-4 text-[13px] text-exception">{error}</p>}

      <RegisterHeader columns={['Control', 'Category', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={6} />
      ) : controls.length === 0 ? (
        <RegisterEmpty>No controls match this filter.</RegisterEmpty>
      ) : (
        controls.map((control) => <ControlRow key={control.id} control={control} />)
      )}
    </div>
  );
}
