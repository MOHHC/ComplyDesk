'use client';

import { useState } from 'react';
import type { WorkspaceSummary } from '@complydesk/shared';
import { AuthShell, Button, Field, Notice, TextLink } from '@/components/ui';
import { findWorkspaces } from '@/lib/api';
import { buildWorkspaceUrl } from '@/lib/session';

const DEMO_EMAIL = 'demo@complydesk.online';
const DEMO_PASSWORD = 'ComplyDeskDemo123!';

/**
 * Shown instead of the login form at the root domain, where no tenant is
 * resolvable. Login is tenant-scoped — the API resolves the workspace
 * from the subdomain — so a password form here could only ever 401, no
 * matter how correct the credentials. This finds the workspace first and
 * sends the browser to its subdomain, where the normal login form works.
 */
export function WorkspaceFinder() {
  const [email, setEmail] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setWorkspaces(null);
    try {
      const found = await findWorkspaces(email);
      if (found.length === 1) {
        // Exactly one: skip the picker entirely and go straight there.
        window.location.href = buildWorkspaceUrl(found[0].slug, '/login');
        return;
      }
      setWorkspaces(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look up workspaces');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Find your workspace"
      intro="Enter your email and we'll take you to your workspace's sign-in page. If you already know your workspace URL, go straight to it."
      footer={
        <>
          Need an account? <TextLink href="/signup">Create a workspace</TextLink>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Looking up…' : 'Continue'}
        </Button>
      </form>

      <div className="mt-6 border-t border-rule pt-5">
        <p className="mb-3 text-[13px] text-ink-muted">
          Just looking around? The demo workspace is pre-loaded with real data — no signup needed.
        </p>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            window.location.href = buildWorkspaceUrl('demo', '/login?demo=1');
          }}
        >
          Try the demo &rarr;
        </Button>
        <p className="mt-2 font-mono text-[11px] text-ink-muted">
          {DEMO_EMAIL} / {DEMO_PASSWORD}
        </p>
      </div>

      {error && (
        <div className="mt-5">
          <Notice>{error}</Notice>
        </div>
      )}

      {workspaces?.length === 0 && (
        <div className="mt-5">
          <Notice tone="neutral" role="status">
            No workspaces found for that email. Check the address, or{' '}
            <TextLink href="/signup">create a new workspace</TextLink>.
          </Notice>
        </div>
      )}

      {workspaces && workspaces.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-1 text-[13px] font-medium text-ink">Choose a workspace</h2>
          <p className="mb-3 text-[13px] text-ink-muted">
            This email has access to {workspaces.length} workspaces.
          </p>
          {/* Register rows, not cards: a fixed gutter rule on the left,
              hairline separators, and the slug in mono because it is a
              record value (it is literally the subdomain). */}
          <ul className="border-t border-rule">
            {workspaces.map((workspace) => (
              <li key={workspace.slug}>
                <a
                  href={buildWorkspaceUrl(workspace.slug, '/login')}
                  className="group flex cursor-pointer items-baseline gap-4 border-b border-l-2 border-rule border-l-transparent py-3 pr-2 pl-3 transition-colors duration-150 hover:border-l-ink hover:bg-paper-raised"
                >
                  <span className="flex-1 text-[14px] font-medium text-ink">{workspace.name}</span>
                  <span className="font-mono text-[12px] text-ink-muted">{workspace.slug}</span>
                  <span
                    aria-hidden="true"
                    className="text-[13px] text-ink-muted transition-colors duration-150 group-hover:text-ink"
                  >
                    &rarr;
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthShell>
  );
}
