import { AuthCoreApiError, AuthErrorCode } from '../shared/auth/errors';
import { AuthMessageType, isAuthMessage } from '../shared/auth/messages';
import type {
  AuthErrorPayload,
  AuthMessage,
  AuthResponse,
  FetchResponseData,
  FujuUserLookupResponseData,
  GetStateResponseData,
  LoginResponseData,
  MfaVerifyResponseData,
  ProviderGetConnectUrlResponseData,
  ProviderGetSocialAccountsResponseData,
} from '../shared/auth/messages';
import * as authManager from './auth-manager';
import * as providerManager from './provider-manager';
import { lookupFujuUser } from './fuju-lookup';
import { handleTelemetrySendEvents } from './telemetry';
import type { TelemetrySendEventsResponseData } from '../shared/auth/messages';

function toErrorPayload(error: unknown): AuthErrorPayload {
  if (error instanceof AuthCoreApiError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof Error) {
    return { code: AuthErrorCode.INTERNAL_SERVER_ERROR, message: error.message };
  }
  return {
    code: AuthErrorCode.INTERNAL_SERVER_ERROR,
    message: 'Unexpected error',
  };
}

async function dispatch(message: AuthMessage): Promise<AuthResponse<unknown>> {
  try {
    switch (message.type) {
      case AuthMessageType.LOGIN: {
        const data: LoginResponseData = await authManager.handleLogin(message.payload);
        return { ok: true, data };
      }
      case AuthMessageType.MFA_VERIFY: {
        const data: MfaVerifyResponseData = await authManager.handleMfaVerify(message.payload);
        return { ok: true, data };
      }
      case AuthMessageType.MFA_CANCEL: {
        await authManager.handleMfaCancel();
        return { ok: true, data: undefined };
      }
      case AuthMessageType.LOGOUT: {
        await authManager.handleLogout();
        return { ok: true, data: undefined };
      }
      case AuthMessageType.GET_STATE: {
        const data: GetStateResponseData = await authManager.getState();
        return { ok: true, data };
      }
      case AuthMessageType.REFRESH: {
        await authManager.refreshTokens();
        return { ok: true, data: undefined };
      }
      case AuthMessageType.FETCH: {
        const data: FetchResponseData = await authManager.authenticatedFetch(
          message.payload.path,
          message.payload.init,
        );
        return { ok: true, data };
      }
      case AuthMessageType.PROVIDER_GET_CONNECT_URL: {
        const data: ProviderGetConnectUrlResponseData = await providerManager.handleGetConnectUrl(
          message.payload.provider,
        );
        return { ok: true, data };
      }
      case AuthMessageType.PROVIDER_GET_SOCIAL_ACCOUNTS: {
        const data: ProviderGetSocialAccountsResponseData =
          await providerManager.handleGetSocialAccounts();
        return { ok: true, data };
      }
      case AuthMessageType.FUJU_USER_LOOKUP: {
        const data: FujuUserLookupResponseData = await lookupFujuUser(message.payload.userId);
        return { ok: true, data };
      }
      case AuthMessageType.TELEMETRY_SEND_EVENTS: {
        const data: TelemetrySendEventsResponseData = await handleTelemetrySendEvents(
          message.payload.events,
        );
        return { ok: true, data };
      }
      default: {
        const exhaustive: never = message;
        return {
          ok: false,
          error: {
            code: AuthErrorCode.INVALID_REQUEST,
            message: `Unknown message: ${JSON.stringify(exhaustive)}`,
          },
        };
      }
    }
  } catch (error) {
    return { ok: false, error: toErrorPayload(error) };
  }
}

function isOwnExtension(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
}

function isPrivilegedContext(sender: chrome.runtime.MessageSender): boolean {
  // popup / options / background は sender.tab を持たない。
  return sender.tab === undefined;
}

// 限定的な read-only API は content script からの呼び出しを許可する。
// これらは accessToken を popup 経由でしか発行できないので、未ログイン時は null が返るだけ。
// TELEMETRY_SEND_EVENTS は content script から呼び出すために allow-list する。
// 未認証時は background 側で `dropped: true` を返すだけなので情報漏れは無い。
const CONTENT_SCRIPT_ALLOWED: ReadonlyArray<AuthMessage['type']> = [
  AuthMessageType.FUJU_USER_LOOKUP,
  AuthMessageType.TELEMETRY_SEND_EVENTS,
];

function isAcceptedSender(
  sender: chrome.runtime.MessageSender,
  type: AuthMessage['type'],
): boolean {
  if (!isOwnExtension(sender)) return false;
  if (isPrivilegedContext(sender)) return true;
  return CONTENT_SCRIPT_ALLOWED.includes(type);
}

export function register(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAuthMessage(message)) {
      return false;
    }
    if (!isAcceptedSender(sender, message.type)) {
      return false;
    }
    dispatch(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({ ok: false, error: toErrorPayload(error) });
      });
    return true;
  });
}
