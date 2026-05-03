const DEFAULT_AUTHCORE_BASE_URL = 'http://localhost:8080';

function readBaseUrl(): string {
  const value = import.meta.env.VITE_AUTHCORE_BASE_URL;
  if (typeof value === 'string' && value.length > 0) {
    return value.replace(/\/$/, '');
  }
  return DEFAULT_AUTHCORE_BASE_URL;
}

export const AUTHCORE_BASE_URL = readBaseUrl();
