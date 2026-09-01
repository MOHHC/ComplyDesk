'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signup } from '@/lib/api';
import { buildHandoffUrl } from '@/lib/session';

export default function SignupPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    tenantName: '',
    tenantSlug: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { accessToken, tenantSlug } = await signup(form);
      // Move to the new workspace's own subdomain rather than staying
      // put. Everything after signup is tenant-scoped — login, /auth/me,
      // every API call — and the tenant is resolved from the subdomain.
      // Staying on the current host leaves the browser pointed at either
      // no tenant (root domain) or, worse, a *different* workspace the
      // new user isn't a member of, which produces a 403 on /auth/me and
      // a 401 on any later login, both of which read as "wrong password".
      //
      // The slug comes from the *response*, never from form.tenantSlug:
      // the server normalizes it (and could later deduplicate it), so the
      // workspace that actually exists is the one it reports back.
      // Trusting the submitted value would aim the browser at a subdomain
      // resolving to a different tenant, or to none.
      //
      // A full page navigation, not router.push: this crosses an origin
      // boundary, which the Next client-side router cannot do.
      window.location.href = buildHandoffUrl(tenantSlug, '/dashboard', accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign up</h1>
      <label>
        Name
        <input value={form.name} onChange={update('name')} required />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={update('email')} required />
      </label>
      <label>
        Password
        <input
          type="password"
          value={form.password}
          onChange={update('password')}
          required
          minLength={8}
        />
      </label>
      <label>
        Workspace name
        <input value={form.tenantName} onChange={update('tenantName')} required />
      </label>
      {/*
        The pattern accepts uppercase because the server lowercases the
        slug before storing it. Rejecting it here instead would block the
        form on a value the API would have accepted and normalized, and
        would make server-side normalization unreachable from this UI.
      */}
      <label>
        Workspace URL
        <input
          value={form.tenantSlug}
          onChange={update('tenantSlug')}
          required
          pattern="[A-Za-z0-9\-]+"
          title="Letters, numbers, and hyphens only (saved in lowercase)"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Signing up…' : 'Sign up'}
      </button>
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
