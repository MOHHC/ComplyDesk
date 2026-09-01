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

export interface MeResponse {
  tenantId: string;
  userId: string;
  role: Role;
}

/** One workspace a given email belongs to, as returned by the
 * root-domain workspace picker. Intentionally carries nothing beyond
 * what's needed to build the subdomain URL and label the choice. */
export interface WorkspaceSummary {
  slug: string;
  name: string;
}
