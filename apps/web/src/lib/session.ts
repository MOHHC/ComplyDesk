'use client';

import { buildTenantUrl } from '@complydesk/shared';

const TOKEN_KEY = 'accessToken';
const HANDOFF_PARAM = 'access_token';

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * URL that lands the browser on a tenant's own subdomain, carrying the
 * freshly-issued token across the origin boundary.
 *
 * The handoff is necessary because localStorage is partitioned per
 * origin: a token written on localhost:3000 is simply not readable on
 * acme.localhost:3000, so signing up and then redirecting would drop the
 * session and bounce the new user straight back to a login form.
 *
 * It rides in the URL *fragment*, not the query string, because
 * fragments are never sent to the server — so the token stays out of
 * access logs and Referer headers. It does land in browser history,
 * which is why consumeHandoffToken() strips it via replaceState the
 * moment it's read. A server-set cookie scoped to the parent domain
 * would avoid history entirely and is the better answer once there's a
 * real domain; it isn't reliable across *.localhost in every browser,
 * which is what this project runs on today.
 */
export function buildHandoffUrl(slug: string, path: string, token: string): string {
  const base = buildTenantUrl(window.location, slug, path);
  return `${base}#${HANDOFF_PARAM}=${encodeURIComponent(token)}`;
}

/** URL for a tenant's subdomain with no token attached — for sending
 * someone to a workspace they still have to log into. */
export function buildWorkspaceUrl(slug: string, path: string): string {
  return buildTenantUrl(window.location, slug, path);
}

/**
 * Picks up a token handed off from another subdomain, persists it to
 * this origin's localStorage, and removes it from the visible URL.
 * Returns true if one was consumed.
 */
export function consumeHandoffToken(): boolean {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return false;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get(HANDOFF_PARAM);
  if (!token) return false;

  storeToken(token);

  params.delete(HANDOFF_PARAM);
  const remaining = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`,
  );
  return true;
}
