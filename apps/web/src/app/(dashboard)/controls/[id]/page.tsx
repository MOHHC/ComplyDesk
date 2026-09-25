'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ClassificationDecision, Control, Evidence, Member } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import {
  createTask,
  getControl,
  listEvidence,
  listMembers,
  retryClassification,
  reviewClassification,
  uploadEvidence,
} from '@/lib/api';
import { Badge, Button, Field, Notice, Spinner } from '@/components/ui';
import { RegisterEmpty, RegisterHeader } from '@/components/register';
import { ProgressChecklist } from '@/components/ProgressChecklist';

// Roles allowed to upload evidence — kept in sync with the API's own
// @Roles(OWNER, ADMIN, CONTRIBUTOR) on POST /controls/:id/evidence. The
// server enforces this regardless; hiding the form for AUDITOR is a UX
// nicety, not the actual boundary.
const CAN_UPLOAD = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR']);
const CAN_ASSIGN = new Set(['OWNER', 'ADMIN']);
const CAN_REVIEW_CLASSIFICATION = CAN_UPLOAD;

function ReviewStatusBadge({ status }: { status: NonNullable<Evidence['classification']>['reviewStatus'] }) {
  if (status === 'CONFIRMED') return <Badge tone="verified">Confirmed</Badge>;
  if (status === 'OVERRIDDEN') return <Badge tone="expiring">Moved</Badge>;
  if (status === 'DISMISSED') return <Badge tone="neutral">Dismissed</Badge>;
  return <Badge tone="expiring">Needs review</Badge>;
}

/** A plain "Retry classification" / "Classify now" trigger shared by the
 * two states that have nothing to review yet — no row at all, and a row
 * whose attempt failed. Same action either way: re-run classification
 * for this evidence file. */
function RetryButton({
  label,
  controlId,
  evidenceId,
  isDemoTenant,
  onDone,
}: {
  label: string;
  controlId: string;
  evidenceId: string;
  isDemoTenant: boolean;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    if (!token) return;
    setRetrying(true);
    setError(null);
    try {
      await retryClassification(token, controlId, evidenceId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        disabled={retrying || isDemoTenant}
        title={isDemoTenant ? 'Disabled on the demo tenant' : undefined}
        onClick={handleRetry}
        className="cursor-pointer text-[12px] font-medium text-ink underline decoration-rule underline-offset-2 hover:decoration-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {retrying ? 'Classifying…' : label}
      </button>
      {isDemoTenant && (
        <p className="mt-1 text-[12px] text-ink-muted">
          Disabled on the public demo tenant, so one visitor can&apos;t use up the next one&apos;s example.
        </p>
      )}
      {error && <p className="mt-1 text-[12px] text-exception">{error}</p>}
    </div>
  );
}

/** The AI classification attached to one evidence row. Three states,
 * deliberately rendered so they can't be mistaken for one another —
 * a real user report was this exact confusion: a genuine Gemini 503
 * left no classification row, which looked identical to evidence that
 * was never classified at all, with no indication anything had gone
 * wrong and no way to retry.
 *
 *  - No row at all (legacy evidence from before this workspace tracked
 *    outcomes, or the rare case an attempt never got a chance to
 *    persist): "Not yet classified" + a first-time "Classify now".
 *  - status: 'FAILED' (a provider error, or the tenant's hourly AI
 *    budget was spent): a clearly-labeled failure with the actual
 *    reason and a "Retry classification" action.
 *  - status: 'COMPLETED': the AI's real output, including its own
 *    reasoned "nothing in this file matches a known control" — that's
 *    a completed classification, not a failure, so it renders with the
 *    normal confirm/dismiss actions and no retry button.
 */
function ClassificationPanel({
  controlId,
  evidence,
  canReview,
  isDemoTenant,
  onReviewed,
}: {
  controlId: string;
  evidence: Evidence;
  canReview: boolean;
  isDemoTenant: boolean;
  onReviewed: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<ClassificationDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const classification = evidence.classification;

  if (!classification) {
    return (
      <div className="mt-1.5">
        <p className="text-[12px] text-ink-muted">Not yet classified.</p>
        {canReview && (
          <RetryButton
            label="Classify now"
            controlId={controlId}
            evidenceId={evidence.id}
            isDemoTenant={isDemoTenant}
            onDone={onReviewed}
          />
        )}
      </div>
    );
  }

  if (classification.status === 'FAILED') {
    return (
      <div className="mt-2 border-l-2 border-l-exception/60 pl-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tone="exception">Classification failed</Badge>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{classification.reasoning}</p>
        {canReview && (
          <RetryButton
            label="Retry classification"
            controlId={controlId}
            evidenceId={evidence.id}
            isDemoTenant={isDemoTenant}
            onDone={onReviewed}
          />
        )}
      </div>
    );
  }

  async function handleDecision(decision: ClassificationDecision) {
    if (!token) return;
    setBusy(decision);
    setDecisionError(null);
    try {
      await reviewClassification(token, controlId, evidence.id, decision);
      onReviewed();
    } catch (err) {
      // Without this, a failed request left the row looking exactly like
      // it had before the click — reviewStatus genuinely never changed,
      // but nothing told you that. It read as "the buttons are still
      // there even though I already made the decision," when what
      // actually happened is the decision was never recorded at all.
      setDecisionError(err instanceof Error ? err.message : 'Failed to record the decision');
    } finally {
      setBusy(null);
    }
  }

  const pending = classification.reviewStatus === 'PENDING';

  return (
    <div className="mt-2 border-l-2 border-l-rule pl-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <ReviewStatusBadge status={classification.reviewStatus} />
        <span className="tabular font-mono text-ink-muted">
          {Math.round(classification.confidence * 100)}% confidence
        </span>
        {classification.suggestedControl ? (
          <span className="text-ink-muted">
            suggests <span className="font-mono text-ink">{classification.suggestedControl.code}</span> —{' '}
            {classification.suggestedControl.title}
          </span>
        ) : (
          <span className="text-ink-muted">no confident match</span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{classification.reasoning}</p>

      {pending && canReview && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => handleDecision('confirm')}
            className="cursor-pointer text-[12px] font-medium text-verified underline decoration-verified/40 underline-offset-2 hover:decoration-verified disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'confirm' ? 'Confirming…' : 'Confirm'}
          </button>
          {classification.suggestedControl && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleDecision('override')}
              className="cursor-pointer text-[12px] font-medium text-expiring underline decoration-expiring/40 underline-offset-2 hover:decoration-expiring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'override' ? 'Moving…' : `Move to ${classification.suggestedControl.code}`}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => handleDecision('dismiss')}
            className="cursor-pointer text-[12px] font-medium text-ink-muted underline decoration-rule underline-offset-2 hover:decoration-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
      {decisionError && <p className="mt-1.5 text-[12px] text-exception">{decisionError}</p>}
    </div>
  );
}

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
  const [uploaded, setUploaded] = useState(false);
  // Bumped after a successful upload to remount the file input: clearing
  // `file` alone leaves the old filename showing next to a disabled button.
  const [fileInputKey, setFileInputKey] = useState(0);

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
      setUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  // Runs once the upload checklist has ticked off.
  function finishUpload() {
    setFile(null);
    setFileInputKey((k) => k + 1);
    setNotes('');
    setUploaded(false);
    setUploading(false);
    refresh();
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

  if (!ready) return null;

  if (error && !control) {
    return (
      <div>
        <Notice>{error}</Notice>
      </div>
    );
  }

  if (!control) return null;

  return (
    <div className="page-enter">
      <header className="mb-6 border-b border-rule pb-3">
        <span className="font-mono text-[12px] text-ink-muted">{control.code}</span>
        <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.015em] text-ink">{control.title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{control.description}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-muted">
          <span>
            Category <span className="text-ink">{control.category}</span>
          </span>
          <span>
            Refresh every <span className="tabular font-mono text-ink">{control.refreshIntervalDays}</span> days
          </span>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">Evidence guidance</summary>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{control.evidenceGuidance}</p>
        </details>
      </header>

      {error && <Notice>{error}</Notice>}

      <section className="mb-8">
        <h2 className="mb-2 text-[13px] font-medium text-ink-muted">Evidence</h2>
        <RegisterHeader columns={['File', 'Collected', 'Notes & classification']} />
        {evidence.length === 0 ? (
          <RegisterEmpty>No evidence uploaded yet.</RegisterEmpty>
        ) : (
          evidence.map((row) => (
            <div key={row.id} className="flex gap-4 border-b border-rule py-3.5 pr-1 pl-1">
              <div className="flex-[1.4] min-w-0">
                <a
                  href={row.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[14px] font-medium text-ink underline decoration-rule underline-offset-2 hover:decoration-ink"
                >
                  {row.fileName}
                </a>
              </div>
              <div className="flex-1 tabular font-mono text-[12px] text-ink-muted">
                {new Date(row.collectedAt).toLocaleDateString()}
              </div>
              <div className="flex-1">
                {row.notes && <p className="text-[13px] text-ink-muted">{row.notes}</p>}
                <ClassificationPanel
                  controlId={id}
                  evidence={row}
                  canReview={Boolean(me && CAN_REVIEW_CLASSIFICATION.has(me.role))}
                  isDemoTenant={Boolean(me?.isDemoTenant)}
                  onReviewed={refresh}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {me && CAN_UPLOAD.has(me.role) && (
        <section className="mb-8 border-t border-rule pt-5">
          <h2 className="mb-3 text-[13px] font-medium text-ink-muted">Upload evidence</h2>
          {me.isDemoTenant && (
            <p className="mb-3 text-[13px] text-ink-muted">
              Uploading is disabled on the public demo tenant, so one visitor can&apos;t change what the next one
              sees.
            </p>
          )}
          <form onSubmit={handleUpload}>
            <div className="mb-4">
              <input
                key={fileInputKey}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                disabled={me.isDemoTenant}
                className="block w-full text-[13px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-rule file:bg-paper-raised file:px-3 file:py-1.5 file:text-[13px] file:text-ink hover:file:border-ink-muted/50 disabled:opacity-50"
              />
            </div>
            <Field
              label="Notes"
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={me.isDemoTenant}
            />
            <Button
              type="submit"
              disabled={uploading || !file || me.isDemoTenant}
              title={me.isDemoTenant ? 'Disabled on the demo tenant' : undefined}
              className="w-auto"
            >
              {uploading ? (
                <>
                  <Spinner className="mr-2" />
                  Uploading & classifying…
                </>
              ) : (
                'Upload'
              )}
            </Button>
            {uploading && file && (
              <div className="mt-5 max-w-md">
                <ProgressChecklist
                  steps={[
                    `Uploading ${file.name}`,
                    'Storing it securely',
                    `Checking it against ${control.code} with AI`,
                  ]}
                  stepMs={900}
                  done={uploaded}
                  onFinished={finishUpload}
                />
              </div>
            )}
          </form>
        </section>
      )}

      {me && CAN_ASSIGN.has(me.role) && (
        <section className="border-t border-rule pt-5">
          <h2 className="mb-3 text-[13px] font-medium text-ink-muted">Assign a task for this control</h2>
          <form onSubmit={handleAssign}>
            <div className="mb-4">
              <label className="mb-1.5 block text-[13px] font-medium text-ink">Assignee</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                required
                className="w-full rounded-sm border border-rule bg-paper-raised px-3 py-2.5 text-[14px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
              >
                <option value="">Select a member</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
            />
            <Field
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
            <Button type="submit" disabled={assigning} className="w-auto">
              {assigning ? 'Assigning…' : 'Assign'}
            </Button>
            {taskMessage && <p className="mt-2 text-[13px] text-ink-muted">{taskMessage}</p>}
          </form>
        </section>
      )}
    </div>
  );
}
