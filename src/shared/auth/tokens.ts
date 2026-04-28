export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  jti?: string;
  type: string;
  aud?: string;
  token_family?: string;
  mfa_verified?: boolean;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const binary = atob(base64);
  try {
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return binary;
  }
}

export function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payloadJson = base64UrlDecode(parts[1]);
  const parsed = JSON.parse(payloadJson) as JwtPayload;
  if (typeof parsed.exp !== 'number' || typeof parsed.iat !== 'number') {
    throw new Error('Invalid JWT payload');
  }
  return parsed;
}

export function isExpired(token: string, skewSeconds = 30): boolean {
  try {
    const payload = decodeJwt(token);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp - skewSeconds <= nowSeconds;
  } catch {
    return true;
  }
}
