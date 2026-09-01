'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { parseSubdomain } from '@complydesk/shared';
import { WorkspaceFinder } from '@/components/WorkspaceFinder';
import { login } from '@/lib/api';
import { storeToken } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // null while undetermined — the hostname is only readable on the
  // client, and rendering either branch during SSR would hydrate wrong.
  const [onTenantSubdomain, setOnTenantSubdomain] = useState<boolean | null>(null);

  useEffect(() => {
    setOnTenantSubdomain(parseSubdomain(window.location.hostname) !== null);
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
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
      <p>
        Need an account? <Link href="/signup">Sign up</Link>
      </p>
    </form>
  );
}
