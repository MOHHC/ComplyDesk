import type { Role } from "./roles";

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
}

/**
 * Signup additionally returns the tenant it actually created.
 *
 * The client must build its post-signup redirect from *this* slug, never
 * from the value it submitted. They happen to be identical today, but
 * only because the server neither normalizes nor deduplicates slugs — if
 * either is ever added, a client trusting its own copy would send the
 * new user to a subdomain that resolves to a different workspace (or to
 * none), which surfaces as a 403 on /auth/me and a 401 on any later
 * login. Making the server's answer authoritative removes that whole
 * class of drift by construction.
 */
export interface SignupResponse extends AuthResponse {
  tenantId: string;
  tenantSlug: string;
}

export interface MeResponse {
  tenantId: string;
  userId: string;
  role: Role;
  /** True only for the public "demo" tenant at demo.complydesk.online —
   * drives the in-app "About this demo" banner and, server-side,
   * DemoReadOnlyGuard's blocking of uploads and AI runs. */
  isDemoTenant: boolean;
}

/** One workspace a given email belongs to, as returned by the
 * root-domain workspace picker. Intentionally carries nothing beyond
 * what's needed to build the subdomain URL and label the choice. */
export interface WorkspaceSummary {
  slug: string;
  name: string;
}

export interface CreateInviteInput {
  role: Role;
}

/** An outstanding (unredeemed, unexpired) invite, as shown on the Team
 * page's pending-invites list. Never carries the code's owning tenant —
 * the caller is always already scoped to it. */
export interface Invite {
  id: string;
  code: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  createdBy: { name: string; email: string };
}

export interface AcceptInviteInput {
  code: string;
  email: string;
  password: string;
  name: string;
}

/** Pre-auth: what the join page shows before anyone has typed anything,
 * fetched by code alone. `valid` is the single field the UI actually
 * gates the form on; `expired`/`used` exist so the page can say *why*
 * not, rather than a generic "invalid invite". */
export interface InviteInfo {
  tenantName: string;
  tenantSlug: string;
  role: Role;
  valid: boolean;
  expired: boolean;
  used: boolean;
}
