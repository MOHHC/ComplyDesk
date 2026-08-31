import type { AuthResponse, LoginInput, MeResponse, SignupInput } from '@complydesk/shared';
import { parseSubdomain } from '@complydesk/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Browsers never let JS override the Host header on fetch/XHR, so the API
 * can't resolve a tenant from Host the way it does for curl or a
 * server-to-server caller. We send the web app's own subdomain via
 * X-Tenant-Slug instead — the API's TenantMiddleware falls back to it
 * whenever Host doesn't resolve a tenant (see apps/api's tenant.middleware.ts).
 */
function tenantHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const slug = parseSubdomain(window.location.hostname);
  return slug ? { 'X-Tenant-Slug': slug } : {};
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...tenantHeaders(),
      ...authHeaders(options.token),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message ?? `Request to ${path} failed with ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }

  return data as T;
}

export function signup(input: SignupInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/signup', { method: 'POST', body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: input });
}

export function getMe(token: string): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', { token });
}
