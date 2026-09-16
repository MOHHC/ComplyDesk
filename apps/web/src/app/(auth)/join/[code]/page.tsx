'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { InviteInfo } from '@complydesk/shared';
import { AuthShell, Button, Field, Notice, TextLink } from '@/components/ui';
import { acceptInvite, getInviteInfo } from '@/lib/api';
import { buildHandoffUrl } from '@/lib/session';

/**
 * The signup variant for joining an existing workspace instead of
 * creating one — reached from a shareable link (see the Team page),
 * always at the root domain, since the recipient has no subdomain of
 * their own yet. Mirrors (auth)/signup/page.tsx's shape deliberately:
 * same form fields (minus the two workspace ones, which the invite
 * already answers), same handoff-redirect pattern on success.
 */
export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getInviteInfo(code)
      .then(setInfo)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'This invite link is not valid'));
  }, [code]);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { accessToken, tenantSlug } = await acceptInvite({ code, ...form });
      // Same reasoning as signup's own redirect: the tenant is resolved
      // from the subdomain everywhere past this point, and the slug
      // comes from the response rather than anything client-known, since
      // the server is the one source of truth for which workspace this
      // invite actually belongs to.
      window.location.href = buildHandoffUrl(tenantSlug, '/dashboard', accessToken);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not join this workspace');
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell title="Invite link">
        <Notice>{loadError}</Notice>
        <p className="mt-4 text-[13px] text-ink-muted">
          <TextLink href="/login">Find your workspace</TextLink> or{' '}
          <TextLink href="/signup">create a new one</TextLink> instead.
        </p>
      </AuthShell>
    );
  }

  if (!info) return null;

  if (!info.valid) {
    return (
      <AuthShell title="Invite link">
        <Notice>
          {info.used
            ? 'This invite has already been used.'
            : 'This invite has expired.'}
        </Notice>
        <p className="mt-4 text-[13px] text-ink-muted">
          Ask whoever sent it for a new link, or{' '}
          <TextLink href="/login">find your own workspace</TextLink> if you already have an account.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${info.tenantName}`}
      intro={`You've been invited to join as ${info.role.toLowerCase()}.`}
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <div className="mb-6 flex items-baseline justify-between border-y border-rule py-2.5">
        <span className="text-[13px] text-ink-muted">Workspace</span>
        <span className="font-mono text-[13px] font-medium text-ink">{info.tenantSlug}</span>
      </div>

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
        {submitError && (
          <div className="mb-4">
            <Notice>{submitError}</Notice>
          </div>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Joining…' : `Join ${info.tenantName}`}
        </Button>
      </form>
    </AuthShell>
  );
}
