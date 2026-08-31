'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listTasks, updateTaskStatus } from '@/lib/api';

const STATUS_OPTIONS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

export default function TasksPage() {
  const { token, me, ready } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    listTasks(token, { status: filter || undefined })
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [token, filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      <h1>Tasks</h1>
      <p>
        Assign a task from a control&apos;s own page. This view lists everything assigned
        across the workspace.
      </p>
      <label>
        Status{' '}
        <select value={filter} onChange={(e) => setFilter(e.target.value as TaskStatus | '')}>
          <option value="">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e2e2' }}>
              <th>Title</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              // A CONTRIBUTOR may only move their own task — the server
              // enforces this on PATCH /tasks/:id/status regardless; this
              // just avoids rendering a control that would 403.
              const canChangeStatus =
                me?.role === 'OWNER' || me?.role === 'ADMIN' || task.assigneeId === me?.userId;
              return (
                <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td>{task.title}</td>
                  <td>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}</td>
                  <td>
                    {canChangeStatus ? (
                      <select
                        value={task.status}
                        onChange={(e) =>
                          handleStatusChange(task.id, e.target.value as TaskStatus)
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      task.status
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loading && tasks.length === 0 && <p>No tasks match this filter.</p>}
    </div>
  );
}
