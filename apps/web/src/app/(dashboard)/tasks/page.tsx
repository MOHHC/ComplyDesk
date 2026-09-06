'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listTasks, updateTaskStatus } from '@/lib/api';
import { Badge, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

const STATUS_OPTIONS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const STATUS_TONE: Record<TaskStatus, 'verified' | 'expiring' | 'neutral'> = {
  DONE: 'verified',
  IN_PROGRESS: 'expiring',
  TODO: 'neutral',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

export default function TasksPage() {
  const { token, me, ready } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Used to re-fetch after a mutation (e.g. a status change) completes —
  // a plain, un-guarded fetch is fine there since it's a one-off request
  // triggered by a user action, not a value this effect re-runs on.
  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    listTasks(token, { status: filter || undefined })
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [token, filter]);

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    setLoading(true);
    listTasks(token, { status: filter || undefined })
      .then((data) => { if (!ignore) setTasks(data); })
      .catch((err) => { if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load tasks'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [token, filter]);

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    if (!token) return;
    try {
      await updateTaskStatus(token, taskId, status);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  }

  if (!ready) return null;

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Tasks</h1>
        <span className="font-mono text-[11px] text-ink-muted">{loading ? '—' : `${tasks.length} shown`}</span>
      </header>
      <p className="mb-5 text-[13px] text-ink-muted">
        Assign a task from a control&apos;s own page. This view lists everything assigned across the workspace.
      </p>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as TaskStatus | '')}
        className="mb-5 rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
      >
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      {error && <Notice>{error}</Notice>}

      <RegisterHeader columns={['Title', 'Due', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={4} />
      ) : tasks.length === 0 ? (
        <RegisterEmpty>No tasks match this filter.</RegisterEmpty>
      ) : (
        tasks.map((task) => {
          // A CONTRIBUTOR may only move their own task — the server
          // enforces this on PATCH /tasks/:id/status regardless; this
          // just avoids rendering a control that would 403.
          const canChangeStatus =
            me?.role !== 'AUDITOR' &&
            (me?.role === 'OWNER' || me?.role === 'ADMIN' || task.assigneeId === me?.userId);
          return (
            <div key={task.id} className="flex items-center gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <span className="flex-[1.4] truncate text-[14px] font-medium text-ink">{task.title}</span>
              <span className="flex-1 tabular font-mono text-[12px] text-ink-muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
              </span>
              <span className="flex-1">
                {canChangeStatus ? (
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(task.id, e.target.value as TaskStatus)}
                    className="rounded-sm border border-rule bg-paper-raised px-2 py-1 text-[12px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
