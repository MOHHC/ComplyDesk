'use client';

import { useState } from 'react';
import { AuthShell, Button, Field, Notice, TextLink } from '@/components/ui';
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

  const slugPreview = form.tenantSlug.trim().toLowerCase();

  return (
    <AuthShell
      title="Create a workspace"
      intro="Your workspace starts with 18 baseline controls, ready to collect evidence against."
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          value={form.name}
          onChange={update('name')}
          required
        />
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          required
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update('password')}
          required
          minLength={8}
          hint="At least 8 characters"
        />

        <div className="my-6 border-t border-rule pt-5">
          <Field
            label="Workspace name"
            name="tenantName"
            autoComplete="organization"
            value={form.tenantName}
            onChange={update('tenantName')}
            required
          />
          {/*
            The pattern accepts uppercase because the server lowercases the
            slug before storing it. Rejecting it here instead would block the
            form on a value the API would have accepted and normalized, and
            would make server-side normalization unreachable from this UI.
          */}
          <Field
            label="Workspace URL"
            name="tenantSlug"
            value={form.tenantSlug}
            onChange={update('tenantSlug')}
            required
            pattern="[A-Za-z0-9\-]+"
            title="Letters, numbers, and hyphens only (saved in lowercase)"
            hint={
              slugPreview
                ? `${slugPreview}.complydesk.com`
                : 'Letters, numbers, and hyphens — saved in lowercase'
            }
          />
        </div>

        {error && (
          <div className="mb-4">
            <Notice>{error}</Notice>
          </div>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating workspace…' : 'Create workspace'}
        </Button>
      </form>
    </AuthShell>
  );
}
