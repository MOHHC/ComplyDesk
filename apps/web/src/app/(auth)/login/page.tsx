'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseSubdomain } from '@complydesk/shared';
import { WorkspaceFinder } from '@/components/WorkspaceFinder';
import { AuthShell, Button, Field, Notice, TextLink } from '@/components/ui';
import { login } from '@/lib/api';
import { storeToken } from '@/lib/session';

const DEMO_EMAIL = 'demo@complydesk.online';
const DEMO_PASSWORD = 'ComplyDeskDemo123!';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [prefilledDemo, setPrefilledDemo] = useState(false);

  // null while undetermined — the hostname is only readable on the
  // client, and rendering either branch during SSR would hydrate wrong.
  const [onTenantSubdomain, setOnTenantSubdomain] = useState<boolean | null>(null);

  useEffect(() => {
    const slug = parseSubdomain(window.location.hostname);
    setWorkspace(slug);
    setOnTenantSubdomain(slug !== null);

    // Read the query string directly (not useSearchParams()) so this
    // page can stay a plain static export like the rest of (auth)/,
    // same reasoning as reading window.location.hostname above.
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      setEmail(DEMO_EMAIL);
      setPassword(DEMO_PASSWORD);
      setPrefilledDemo(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { accessToken } = await login({ email, password });
      storeToken(accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  }

  if (onTenantSubdomain === null) {
    return null;
  }

  // Root domain: there's no tenant to log into. Login is tenant-scoped,
  // so a form here can only ever fail — find the workspace first.
  if (!onTenantSubdomain) {
    return <WorkspaceFinder />;
  }

  return (
    <AuthShell
      title="Sign in"
      intro="Use the account registered to this workspace."
      footer={
        <>
          Need an account? <TextLink href="/signup">Create a workspace</TextLink>
        </>
      }
    >
      {/* The workspace is a record value, so it is set in mono — and
          showing it here answers "am I signing into the right place?",
          which is exactly the question a tenant-scoped login raises. */}
      {workspace && (
        <div className="mb-6 flex items-baseline justify-between border-y border-rule py-2.5">
          <span className="text-[13px] text-ink-muted">Workspace</span>
          <span className="font-mono text-[13px] font-medium text-ink">{workspace}</span>
        </div>
      )}

      {prefilledDemo && (
        <div className="mb-6">
          <Notice tone="neutral" role="status">
            Demo credentials filled in — just click Sign in.
          </Notice>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate={false}>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <div className="mb-4">
            <Notice>{error}</Notice>
          </div>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
