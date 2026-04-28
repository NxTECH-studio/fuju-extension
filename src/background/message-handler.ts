import { AuthCoreApiError, AuthErrorCode } from '../shared/auth/errors';
import {
  AuthMessageType,
  isAuthMessage,
} from '../shared/auth/messages';
import type {
  AuthErrorPayload,
  AuthMessage,
  AuthResponse,
  FetchResponseData,
  GetStateResponseData,
  LoginResponseData,
  MfaVerifyResponseData,
} from '../shared/auth/messages';
import * as authManager from './auth-manager';

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
        const data: MfaVerifyResponseData = await authManager.handleMfaVerify(
          message.payload,
        );
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

function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  // Only accept messages originating from this extension's own contexts (popup / options /
  // background). Reject content scripts (sender.tab is set) so web pages cannot drive
  // login/logout/fetch through the message API.
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  return sender.tab === undefined;
}

export function register(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTrustedSender(sender)) {
      return false;
    }
    if (!isAuthMessage(message)) {
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
