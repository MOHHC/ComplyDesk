'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Invite, Member } from '@complydesk/shared';
import { buildRootUrl } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { createInvite, listInvites, listMembers } from '@/lib/api';
import { Button, Notice } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

const CAN_INVITE = new Set(['OWNER', 'ADMIN']);
const INVITABLE_ROLES: Invite['role'][] = ['ADMIN', 'CONTRIBUTOR', 'AUDITOR'];

export default function TeamPage() {
  const { token, me, ready } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [role, setRole] = useState<Invite['role']>('CONTRIBUTOR');
  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    // Both, not just token: useAuth() sets token and me from two
    // separate state updates (token synchronously from localStorage, me
    // later from the async /auth/me call), so there's a real render
    // where token is already set but me is still null. Gating on token
    // alone let that transient render's CAN_INVITE.has(me?.role ?? '')
    // evaluate against an empty string, permanently skipping
    // listInvites() for that fetch — found by an actual browser
    // round-trip, not a hunch: /members came back with real data while
    // /invites never fired at all.
    if (!token || !me) return;
    setLoading(true);
    Promise.all([listMembers(token), CAN_INVITE.has(me.role) ? listInvites(token) : Promise.resolve([])])
      .then(([m, i]) => {
        setMembers(m);
        setInvites(i);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load team'))
      .finally(() => setLoading(false));
  }, [token, me?.role]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const invite = await createInvite(token, { role });
      setNewInvite(invite);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  }

  function inviteLink(code: string): string {
    return buildRootUrl(window.location, `/join/${code}`);
  }

  async function handleCopy(link: string) {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!ready) return null;

  return (
    <div className="page-enter">
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Team</h1>
        <span className="font-mono text-[11px] text-ink-muted">
          {loading ? '—' : `${members.length} member${members.length === 1 ? '' : 's'}`}
        </span>
      </header>

      {error && <Notice>{error}</Notice>}

      {me && CAN_INVITE.has(me.role) && (
        <section className="mb-8 border-b border-rule pb-6">
          <h2 className="mb-3 text-[13px] font-medium text-ink-muted">Invite someone</h2>
          <form onSubmit={handleCreateInvite} className="flex flex-wrap items-center gap-3">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Invite['role'])}
              className="rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-[13px] text-ink hover:border-ink-muted/50 focus:border-ink focus:outline-none"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={creating} className="w-auto">
              {creating ? 'Generating…' : 'Generate invite link'}
            </Button>
          </form>

          {newInvite && (
            <div className="mt-4 border border-rule bg-paper-raised px-4 py-3">
              <p className="mb-2 text-[13px] text-ink-muted">
                Share this link — anyone who opens it joins as <span className="font-mono text-ink">{newInvite.role}</span>.
                Valid for 7 days, usable once.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={inviteLink(newInvite.code)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-sm border border-rule bg-paper px-3 py-1.5 font-mono text-[12px] text-ink"
                />
                <Button type="button" variant="quiet" onClick={() => handleCopy(inviteLink(newInvite.code))}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          {invites.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-muted uppercase">
                Pending invites
              </h3>
              <ul className="border-t border-rule">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center gap-3 border-b border-rule py-2.5 text-[13px]"
                  >
                    <span className="font-mono text-ink">{invite.role}</span>
                    <span className="text-ink-muted">
                      invited by {invite.createdBy.name} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(inviteLink(invite.code))}
                      className="ml-auto cursor-pointer text-[12px] font-medium text-ink underline decoration-rule underline-offset-2 hover:decoration-ink"
                    >
                      Copy link
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <RegisterHeader columns={['Name', 'Email', 'Role']} />
      {loading ? (
        <RegisterSkeletonRows count={4} />
      ) : members.length === 0 ? (
        <RegisterEmpty>No members yet.</RegisterEmpty>
      ) : (
        members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center gap-4 border-b border-rule py-3.5 pr-1 pl-1 text-[14px]"
          >
            <span className="flex-[1.4] truncate font-medium text-ink">{member.name}</span>
            <span className="flex-1 truncate text-[13px] text-ink-muted">{member.email}</span>
            <span className="flex-1 font-mono text-[12px] text-ink-muted">{member.role}</span>
          </div>
        ))
      )}
    </div>
  );
}
