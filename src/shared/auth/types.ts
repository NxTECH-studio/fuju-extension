export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface PreTokenResponse {
  pre_token: string;
  mfa_required: true;
  token_type: 'Bearer';
  expires_in: number;
}

export type LoginResponse = TokenResponse | PreTokenResponse;

export interface User {
  id: string;
  email: string;
  public_id: string;
  mfa_enabled: boolean;
  icon_url: string | null;
  created_at: string;
}

export interface AuthCoreError {
  error: string;
  message: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

export function isPreTokenResponse(value: LoginResponse): value is PreTokenResponse {
  return (value as PreTokenResponse).mfa_required === true;
}
