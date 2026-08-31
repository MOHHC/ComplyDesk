import type { AuthResponse, LoginInput, SignupInput } from '@complydesk/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message ?? `Request to ${path} failed with ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }

  return data as T;
}

export function signup(input: SignupInput): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/signup', input);
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/login', input);
}
