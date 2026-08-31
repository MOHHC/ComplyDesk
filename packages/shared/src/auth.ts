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
