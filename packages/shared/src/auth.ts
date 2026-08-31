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
