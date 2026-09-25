'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A checklist shown while a slow request is in flight (creating a
 * workspace, signing in, running gap analysis, uploading a document).
 * Each step names something the endpoint really does, in the order it
 * does it — the list is a readable account of the work, not decoration.
 *
 * These requests are single round-trips with no per-step progress to
 * report, so steps advance on a timer and the last one holds, spinning,
 * until the request settles. Once `done` flips, whatever is left ticks
 * off quickly, the list clears, and `onFinished` fires. A fast response
 * still shows every step being checked; a slow one never shows a step
 * as done before the server is. On failure the caller simply unmounts
 * this and shows its error.
 *
 * With `readyTitle`, a short "ready" line is shown between the list
 * clearing and `onFinished` — for flows that navigate away afterwards.
 */
const FINISH_STEP_MS = 180;
const SETTLE_MS = 350;
const CLEAR_MS = 450;
const READY_MS = 800;

export function ProgressChecklist({
  steps,
  done,
  onFinished,
  stepMs = 650,
  readyTitle,
  readyDetail,
}: {
  steps: string[];
  /** True once the underlying request has succeeded. */
  done: boolean;
  onFinished: () => void;
  /** How long each step shows while the request is still running. */
  stepMs?: number;
  readyTitle?: string;
  readyDetail?: string;
}) {
  // Steps before `active` are checked; `active` itself is in progress.
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<'working' | 'clearing' | 'ready'>('working');
  const allChecked = active >= steps.length;

  // The list's height, captured as it starts clearing and held as a
  // min-height, so the shorter "ready" line doesn't make a vertically
  // centered page (AuthShell) jump.
  const rootRef = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);

  // Callers usually pass an inline arrow; holding the latest one in a
  // ref keeps a parent re-render from restarting the final timers.
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  useEffect(() => {
    if (phase !== 'working') return;
    if (allChecked) {
      const t = setTimeout(() => {
        setHeldHeight(rootRef.current?.offsetHeight);
        setPhase('clearing');
      }, SETTLE_MS);
      return () => clearTimeout(t);
    }
    // Hold on the last step until the server has actually finished.
    if (!done && active === steps.length - 1) return;
    const t = setTimeout(() => setActive((a) => a + 1), done ? FINISH_STEP_MS : stepMs);
    return () => clearTimeout(t);
  }, [phase, active, done, allChecked, steps.length, stepMs]);

  useEffect(() => {
    if (phase === 'clearing') {
      const t = setTimeout(() => {
        if (readyTitle) setPhase('ready');
        else onFinishedRef.current();
      }, CLEAR_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'ready') {
      const t = setTimeout(() => onFinishedRef.current(), READY_MS);
      return () => clearTimeout(t);
    }
  }, [phase, readyTitle]);

  const statusText =
    phase === 'ready'
      ? `${readyTitle}. ${readyDetail ?? ''}`
      : allChecked
        ? 'All steps complete.'
        : steps[active];

  return (
    <div ref={rootRef} className="page-enter" style={{ minHeight: heldHeight }}>
      <p className="sr-only" role="status" aria-live="polite">
        {statusText}
      </p>

      {phase !== 'ready' ? (
        <ol
          aria-hidden="true"
          className={`border-t border-rule transition-[opacity,transform] duration-[var(--duration-base)] ease-[var(--ease-out)] ${
            phase === 'clearing' ? '-translate-y-1 opacity-0' : ''
          }`}
        >
          {steps.map((label, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'pending';
            return (
              <li
                key={i}
                className="register-row-enter flex items-center gap-3 border-b border-rule py-3"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <StepMark state={state} />
                <span
                  className={`min-w-0 text-[14px] transition-colors duration-150 ${
                    state === 'pending' ? 'text-ink-muted/60' : state === 'active' ? 'text-ink' : 'text-ink-muted'
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div aria-hidden="true" className="page-enter border-y border-rule py-6">
          <div className="flex items-center gap-3">
            <StepMark state="done" large />
            <p className="text-[16px] font-semibold text-ink">{readyTitle}</p>
          </div>
          {readyDetail && (
            <p className="mt-2 pl-[30px] font-mono text-[12px] break-all text-ink-muted">{readyDetail}</p>
          )}
        </div>
      )}
    </div>
  );
}

function StepMark({ state, large = false }: { state: 'pending' | 'active' | 'done'; large?: boolean }) {
  const size = large ? 'h-[18px] w-[18px]' : 'h-[14px] w-[14px]';
  if (state === 'active') {
    // Ink-on-paper counterpart to <Spinner/>, which is paper-colored for
    // use on primary buttons and would be invisible here.
    return (
      <span
        className={`inline-block ${size} shrink-0 animate-spin rounded-full border-2 border-ink/20 border-t-ink`}
      />
    );
  }
  if (state === 'pending') {
    return <span className={`inline-block ${size} shrink-0 rounded-sm border border-rule`} />;
  }
  return (
    <span
      className={`check-pop inline-flex ${size} shrink-0 items-center justify-center rounded-sm bg-verified text-paper`}
    >
      <svg viewBox="0 0 12 12" className="h-[70%] w-[70%]" fill="none">
        <path
          className="check-draw"
          d="M2.5 6.2 5 8.5 9.5 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
