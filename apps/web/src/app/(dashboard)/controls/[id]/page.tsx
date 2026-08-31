'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Control, Evidence, Member } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { createTask, getControl, listEvidence, listMembers, uploadEvidence } from '@/lib/api';

// Roles allowed to upload evidence — kept in sync with the API's own
// @Roles(OWNER, ADMIN, CONTRIBUTOR) on POST /controls/:id/evidence. The
// server enforces this regardless; hiding the form for AUDITOR is a UX
// nicety, not the actual boundary.
const CAN_UPLOAD = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR']);
const CAN_ASSIGN = new Set(['OWNER', 'ADMIN']);

export default function ControlDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, me, ready } = useAuth();

  const [control, setControl] = useState<Control | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const [assigneeId, setAssigneeId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    Promise.all([getControl(token, id), listEvidence(token, id)])
      .then(([c, e]) => {
        setControl(c);
        setEvidence(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load control'));
  }, [token, id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    listMembers(token).then(setMembers).catch(() => {});
  }, [token]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadEvidence(token, id, file, notes);
      setFile(null);
      setNotes('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !assigneeId || !taskTitle || !dueDate) return;
    setAssigning(true);
    setTaskMessage(null);
    try {
      await createTask(token, { controlId: id, assigneeId, title: taskTitle, dueDate });
      setTaskTitle('');
      setDueDate('');
      setTaskMessage('Task created.');
    } catch (err) {
      setTaskMessage(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setAssigning(false);
    }
  }

  if (!ready || !control) return null;

  return (
    <div>
      <h1>
        {control.code} — {control.title}
      </h1>
      <p>{control.description}</p>
      <p>
        <strong>Category:</strong> {control.category} &nbsp;
        <strong>Refresh interval:</strong> {control.refreshIntervalDays} days &nbsp;
        <strong>Status:</strong> {control.status}
      </p>
      <details>
        <summary>Evidence guidance</summary>
        <p>{control.evidenceGuidance}</p>
      </details>

      {error && <p role="alert">{error}</p>}

      <h2>Evidence</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e2e2' }}>
            <th>File</th>
            <th>Notes</th>
            <th>Collected</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((row) => (
            <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td>{row.fileName}</td>
              <td>{row.notes ?? '—'}</td>
              <td>{new Date(row.collectedAt).toLocaleDateString()}</td>
              <td>
                <a href={row.downloadUrl} target="_blank" rel="noreferrer">
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {evidence.length === 0 && <p>No evidence uploaded yet.</p>}

      {me && CAN_UPLOAD.has(me.role) && (
        <form onSubmit={handleUpload} style={{ marginTop: '1rem' }}>
          <h3>Upload evidence</h3>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="submit" disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}

      {me && CAN_ASSIGN.has(me.role) && (
        <form onSubmit={handleAssign} style={{ marginTop: '1.5rem' }}>
          <h3>Assign a task for this control</h3>
          <label>
            Assignee{' '}
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
              <option value="">Select a member</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </label>
          <input
            type="text"
            placeholder="Task title"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            required
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
          <button type="submit" disabled={assigning}>
            {assigning ? 'Assigning…' : 'Assign'}
          </button>
          {taskMessage && <p>{taskMessage}</p>}
        </form>
      )}
    </div>
  );
}
