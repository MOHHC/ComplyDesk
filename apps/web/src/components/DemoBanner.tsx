import Link from 'next/link';

/**
 * Shown on every page of the public demo tenant (demo.complydesk.online)
 * — the one thing a recruiter or visitor sees with zero setup. Written
 * for someone giving this 2-3 minutes, not a developer reading docs.
 * Uploads and AI runs are disabled for this tenant (DemoReadOnlyGuard on
 * the API side) so one visitor's clicking can't spoil the next
 * visitor's demo — this banner is what explains why a button might
 * refuse to do anything.
 */
export function DemoBanner() {
  return (
    <div className="mb-8 border border-rule bg-paper-raised px-5 py-4 text-[13px] leading-relaxed text-ink-muted">
      <p className="mb-2">
        <span className="font-medium text-ink">This is the public ComplyDesk demo.</span> ComplyDesk is a compliance
        register for teams chasing SOC 2 — it replaces the usual spreadsheet-and-screenshots setup with a real
        register: controls, evidence, an AI layer that reads what you upload, and a dashboard of what's covered,
        missing, or about to expire. Everything below is real, pre-generated data — nothing was faked for the tour.
      </p>
      <p>
        Worth two minutes:{' '}
        <Link href="/dashboard" className="font-medium text-ink underline underline-offset-2">
          Dashboard
        </Link>{' '}
        for the readiness overview, then{' '}
        <Link href="/controls" className="font-medium text-ink underline underline-offset-2">
          Controls
        </Link>{' '}
        — click one to see its evidence and the AI's classification of it — then{' '}
        <Link href="/gap-analysis" className="font-medium text-ink underline underline-offset-2">
          Gap Analysis
        </Link>{' '}
        for a citation-backed coverage report already run against a real policy document, then{' '}
        <Link href="/tasks" className="font-medium text-ink underline underline-offset-2">
          Tasks
        </Link>
        . Uploading and re-running the AI are turned off here so one visitor can't use up the next one's demo — sign
        up for your own workspace to try those for real.
      </p>
    </div>
  );
}
