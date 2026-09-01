'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkspaceSummary } from '@complydesk/shared';
import { findWorkspaces } from '@/lib/api';
import { buildWorkspaceUrl } from '@/lib/session';

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
    <div>
      <h1>Find your workspace</h1>
      <p>
        Enter your email and we&apos;ll take you to your workspace&apos;s sign-in page. If you
        already know your workspace URL, go straight to it instead.
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Looking up…' : 'Continue'}
        </button>
      </form>

      {error && <p role="alert">{error}</p>}

      {workspaces?.length === 0 && (
        <p role="status">
          No workspaces found for that email. Check the address, or{' '}
          <Link href="/signup">create a new workspace</Link>.
        </p>
      )}

      {workspaces && workspaces.length > 1 && (
        <div>
          <h2>Choose a workspace</h2>
          <ul>
            {workspaces.map((workspace) => (
              <li key={workspace.slug}>
                <a href={buildWorkspaceUrl(workspace.slug, '/login')}>
                  {workspace.name} <span>({workspace.slug})</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>
        Need an account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  );
}
