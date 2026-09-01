import type {
  AuthResponse,
  Control,
  ControlStatus,
  Evidence,
  LoginInput,
  MeResponse,
  Member,
  ReadinessSummary,
  SignupInput,
  SignupResponse,
  Task,
  TaskStatus,
  WorkspaceSummary,
} from '@complydesk/shared';
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

async function handleResponse<T>(res: Response, path: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message ?? `Request to ${path} failed with ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return data as T;
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
  return handleResponse<T>(res, path);
}

/** Separate from request(): a FormData body must NOT get a manual
 * Content-Type — the browser sets one itself, including the multipart
 * boundary, which is impossible to reproduce by hand correctly. */
async function requestMultipart<T>(
  path: string,
  body: FormData,
  token: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...tenantHeaders(), ...authHeaders(token) },
    body,
  });
  return handleResponse<T>(res, path);
}

export function signup(input: SignupInput): Promise<SignupResponse> {
  return request<SignupResponse>('/auth/signup', { method: 'POST', body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: input });
}

export function getMe(token: string): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', { token });
}

/** Workspaces this email belongs to. Used by the root-domain picker to
 * send people to the right subdomain, since login itself is tenant-scoped
 * and can't succeed without one. */
export function findWorkspaces(email: string): Promise<WorkspaceSummary[]> {
  return request<WorkspaceSummary[]>('/auth/workspaces', {
    method: 'POST',
    body: { email },
  });
}

export function listControls(
  token: string,
  filter: { category?: string; status?: ControlStatus } = {},
): Promise<Control[]> {
  const params = new URLSearchParams();
  if (filter.category) params.set('category', filter.category);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return request<Control[]>(`/controls${qs ? `?${qs}` : ''}`, { token });
}

export function getControl(token: string, id: string): Promise<Control> {
  return request<Control>(`/controls/${id}`, { token });
}

export function listEvidence(token: string, controlId: string): Promise<Evidence[]> {
  return request<Evidence[]>(`/controls/${controlId}/evidence`, { token });
}

export function uploadEvidence(
  token: string,
  controlId: string,
  file: File,
  notes: string,
): Promise<Evidence> {
  const form = new FormData();
  form.set('file', file);
  if (notes) form.set('notes', notes);
  return requestMultipart<Evidence>(`/controls/${controlId}/evidence`, form, token);
}

export function listTasks(
  token: string,
  filter: { status?: TaskStatus; assigneeId?: string; controlId?: string } = {},
): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.assigneeId) params.set('assigneeId', filter.assigneeId);
  if (filter.controlId) params.set('controlId', filter.controlId);
  const qs = params.toString();
  return request<Task[]>(`/tasks${qs ? `?${qs}` : ''}`, { token });
}

export function createTask(
  token: string,
  dto: { controlId: string; assigneeId: string; title: string; description?: string; dueDate: string },
): Promise<Task> {
  return request<Task>('/tasks', { method: 'POST', body: dto, token });
}

export function updateTaskStatus(token: string, id: string, status: TaskStatus): Promise<Task> {
  return request<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: { status }, token });
}

export function getReadiness(token: string): Promise<ReadinessSummary> {
  return request<ReadinessSummary>('/dashboard/readiness', { token });
}

export function listMembers(token: string): Promise<Member[]> {
  return request<Member[]>('/members', { token });
}
