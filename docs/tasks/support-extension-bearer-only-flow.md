# 拡張側で Bearer-only / body-mode な認証フローに対応する

## 概要

AuthCore 側で正式採用された **`X-Token-Delivery: body` opt-in ヘッダ**を使い、本拡張の認証フロー全体を「HttpOnly cookie 非依存・JSON body で refresh_token を授受する body-mode」に切り替える。あわせて provider connect / callback を「Bearer 付き JSON 取得 + `launchWebAuthFlow` の closed-context redirect に fragment でトークン受領」する新方式に置き換え、PR #4 で残っていた `opaqueredirect` 問題を解消する。

## 依存関係

- 本タスクは以下のマージ完了**後に** `develop` から新ブランチを切る前提。
  - PR #4: `feat/integrate-fuju-auth`（AuthCore 統合の本体）
  - 本ブランチ `fix/hide-icon-on-fetch-error` のマージ
- AuthCore 側タスク `support-extension-bearer-only-flow`（`fuju-system-authentication/docs/tasks/support-extension-bearer-only-flow.md`）の本番デプロイ完了が前提。AuthCore リリース前に拡張をリリースすると全認証が壊れる。
- `EXTENSION_REDIRECT_ALLOW_LIST` への拡張機能 ID 登録（運用タスク）が完了している必要がある（provider 経由のサインアップ/ログインを実装する場合）。

## 背景・目的

### 現状の問題

1. **refresh_token が cookie 依存**: 本拡張は AuthCore の `Set-Cookie: refresh_token=...` を `chrome.cookies.get` で読み出して `Cookie` ヘッダに乗せ直す回避策で動かしている (`src/background/auth-manager.ts` の `readRefreshCookie` / `buildCookieHeader`)。`host_permissions` と AuthCore 側の Set-Cookie が完全に揃わないと自動 refresh が壊れる脆い構成。
2. **`/v1/auth/connect/{provider}` の `opaqueredirect` 問題**: `launchWebAuthFlow` は任意ヘッダを付けられないため background から `redirect: 'manual'` で fetch して Location を抜き出そうとするが、本番想定のクロスオリジン構成では `response.type === 'opaqueredirect'` となり Location を読めない (`src/shared/auth/providers.ts:70-77`)。popup の X / Google 連携ボタンが事実上機能しない。
3. **callback の二度引き**: 現状は `launchWebAuthFlow` の終了 URL から `code` / `state` を抜き出し、background から再度 `/v1/auth/callback/{provider}` を Bearer 付きで叩く実装。AuthCore 側で provider OAuth の callback 処理が既に完了しているのに拡張からもう一度叩く構造で、エラーハンドリングと state 二重消費のリスクがある。

### AuthCore 側で確定した仕様（採用済み）

`X-Token-Delivery: body` opt-in ヘッダで、cookie を一切使わない body-mode を全認証エンドポイントに導入する設計。本拡張は body-mode を採用すべきクライアント。

#### ヘッダ契約

| 値 | 意味 | 既定 |
|---|---|---|
| `cookie` | refresh_token は Set-Cookie / Cookie で授受 | 未指定時 |
| `body` | refresh_token は JSON body で授受、Set-Cookie / Cookie 使わない | 拡張機能・モバイルが指定 |

- 大文字小文字区別なし
- 不正値は 400 `INVALID_REQUEST`
- CORS: `Access-Control-Allow-Headers` に `X-Token-Delivery` 追加済み

#### エンドポイント別の挙動（body-mode）

- **`POST /v1/auth/login`** — レスポンス body に `refresh_token` と `refresh_expires_in` を追加。Set-Cookie なし。MFA 必須ユーザーの `pre_token` 応答は mode 無関係で同形。
- **`POST /v1/auth/refresh`** — リクエスト body 必須 `{ "refresh_token": "..." }`。Cookie ヘッダがあっても body 優先。レスポンスは login と同形。再利用検知時は `code: TOKEN_REVOKED`。
- **`POST /v1/auth/logout`** — body から refresh_token を読む（空でも 200 idempotent）。Set-Cookie なし、レスポンス `{ "message": "Successfully logged out" }`。
- **`POST /v1/auth/mfa/verify`** — login と同パターン。
- **`GET /v1/auth/connect/{provider}`** — `Accept: application/json` 指定時に `200 OK` + `{ "authorize_url": "...", "state": "..." }` を返す（それ以外は従来どおり 302）。Authorization は `OptionalJWTAuth`（あれば link mode、なければ signup+login mode）。
- **`GET /v1/auth/callback/{provider}`** (signup+login モード) — クエリ `final_redirect=https://<extension-id>.chromiumapp.org/cb` 指定時 `302` で fragment 付き redirect:
  ```
  Location: https://<extension-id>.chromiumapp.org/cb#access_token=...&refresh_token=...&expires_in=900&refresh_expires_in=2592000
  ```
  link mode は `#linked=1&provider=x&provider_user_id=...`。許可リスト `EXTENSION_REDIRECT_ALLOW_LIST` で完全一致検証。

### セキュリティ前提

- body-mode の refresh_token は `chrome.storage.local` に格納される前提。
- transport 混在禁止: 同一 refresh family 内で transport を途中で切替えない。クライアントは初回 login で決めた mode を全 refresh で維持する。
- `final_redirect` は完全一致検証。
- fragment transport は `launchWebAuthFlow` の closed-context redirect では安全（サーバ・ログ・Referer に漏れない、OAuth 2.0 Implicit Flow と同パターン）。

### ゴール

- 本拡張の全認証 fetch が `X-Token-Delivery: body` を送出し、refresh_token を `chrome.storage.local` で完結管理する。
- `chrome.cookies` 依存と Cookie ヘッダ手動注入を撤廃。
- popup の X / Google 連携ボタンが本番想定 AuthCore に対し成功する（`opaqueredirect` ロジック撤去）。
- callback は AuthCore が fragment にトークンを乗せて返すため、background からの callback 二度引きを廃止。

## 影響範囲

### 既存ファイルの変更

- `src/shared/auth/client.ts`
  - 全認証 fetch (`login`, `refresh`, `logout`, `verifyMfa`) に `X-Token-Delivery: body` を必ず付与する。
  - `RefreshOptions` の `cookieHeader` 経路を **削除**し、`refresh` / `logout` の引数を `{ refreshToken: string | null }` に置き換える。
  - `login` / `verifyMfa` のレスポンス型を新スキーマ（`refresh_token`, `refresh_expires_in` 追加）に対応させる。
  - `request()` ヘルパの `cookieHeader` 引数と `Cookie` ヘッダ注入を削除（後方互換不要）。
  - `credentials: 'include'` は body-mode では本質的に不要だが、CORS preflight への影響を避けるため当面残しても良い（最終的には削除推奨）。
- `src/shared/auth/types.ts`
  - `TokenResponse` を body-mode 形に拡張:
    ```ts
    export interface TokenResponse {
      access_token: string;
      refresh_token: string;
      token_type: 'Bearer';
      expires_in: number;
      refresh_expires_in: number;
    }
    ```
  - `PreTokenResponse` は変更不要（mode 無関係で同形）。
- `src/shared/auth/storage.ts`
  - 既存の `setRefreshToken` / `getAuthState` をそのまま使えるが、`AuthTokenSnapshot` を `refreshToken: string`（必須化）に変更し、`setTokens` で必ず両方を一括保存するように整理する（cookie 経路の不在前提化）。
  - `getRefreshToken()` ヘルパを新設:
    ```ts
    export async function getRefreshToken(): Promise<string | null>;
    ```
- `src/background/auth-manager.ts`
  - `readRefreshCookie` / `buildCookieHeader` / `buildCookieUrl` を **完全削除**。
  - `persistTokenResponse` を「レスポンスの `refresh_token` を必ず `setRefreshToken` で保存」に書き換える（cookie 読み出しは無くす）。
  - `refreshTokens` を「`getRefreshToken()` で読み出し、無ければ即時 `clearAll()` + 例外」に書き換え。`refreshRequest({ refreshToken })` 呼び出し。
  - `handleLogout` を「`getRefreshToken()` で読み出して `logoutRequest({ refreshToken })`、終了後 `clearAll()`」に書き換え。
  - `init()` の自動 refresh 経路はそのまま（refresh_token は storage から読む形に置き換わる）。
  - `chrome.cookies` 関連のエラーハンドリングを削除し、`refresh_token` 不在時に `TOKEN_REVOKED` 相当で扱う。
- `src/shared/auth/providers.ts`
  - `getConnectAuthorizeUrl()` を JSON 経路に全面書き換え:
    - `redirect: 'manual'` 撤去、`response.type === 'opaqueredirect'` 検出ロジック削除、行 70-77, 79-87 のフォールバック整理。
    - `Accept: application/json` で GET、レスポンス JSON `{ authorize_url, state }` を parse して `authorize_url` を返す。
    - クエリに `final_redirect=<chrome.identity.getRedirectURL('cb')>` を付与（呼び出し側から渡す）。
    - 引数: `(accessToken: string | null, provider: Provider, finalRedirect: string)` に変更。`accessToken` が null の場合は Authorization ヘッダを付けない（signup+login モード対応のため。link 専用なら null 不可で良い）。
    - 戻り値型を `{ authorizeUrl: string; state: string }` 等に拡張する案も検討（state を popup 側で握る必要が出た場合）。
  - `completeConnectCallback()` を **完全削除**（AuthCore が callback を完結し fragment で結果を返すため）。
- `src/background/provider-manager.ts`
  - `handleGetConnectUrl()`:
    - `chrome.identity.getRedirectURL('cb')` を background で生成して `getConnectAuthorizeUrl` に渡す。
    - link 専用なら必ず `ensureAccessToken()` した上で Bearer を付ける（既存挙動）。
    - 戻り値に `state` を含めるかは popup 側の検証要否次第（後述「signup+login」スコープ判断）。
  - `handleCompleteConnect()` を **削除**。代わりに fragment から得た結果を保存する `handleConsumeProviderFragment()` 等を新設するか、popup 側で完結させる（後述）。
- `src/popup/auth/Dashboard.tsx`
  - `extractCodeAndState` を `extractFragment` に置き換え:
    - `URL.hash` を `URLSearchParams` で parse する。
    - link mode: `linked=1&provider=...&provider_user_id=...` を読み取り、UI に成功表示。
    - signup+login mode（実装する場合）: `access_token=...&refresh_token=...&expires_in=...&refresh_expires_in=...` を抽出し、background に保存依頼を送る。
  - `PROVIDER_COMPLETE_CONNECT` 経由の round-trip を削除し、fragment から直接結果を確定させる。
  - `formatLinkError()` の文言マッピングは維持。新規エラーコードがあれば追加。
- `src/shared/auth/messages.ts`
  - `PROVIDER_COMPLETE_CONNECT` メッセージ型を **削除**（fragment 完結のため不要）。
  - signup+login をスコープに含める場合、新メッセージ `PROVIDER_CONSUME_TOKENS` 等を追加（fragment から得た token を background の storage に保存する依頼）。link 専用に絞る場合は不要。
- `src/shared/config.ts`
  - `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_PATH` を **削除**（cookie 不要に）。
- `public/manifest.json`
  - `cookies` permission が `permissions` 配列にあれば削除（`grep` で要確認）。`identity` / `host_permissions` は維持。
- `docs/overview.md`
  - 「メッセージプロトコル」表の `PROVIDER_GET_CONNECT_URL` 説明を「Bearer + `final_redirect` で JSON から authorize URL を受け取る」に更新。
  - 「メッセージプロトコル」表から `PROVIDER_COMPLETE_CONNECT` 行を削除。
  - 「ストレージ」セクションに「`auth.refreshToken` は body-mode で AuthCore から受信した値を保存する」旨を追記。
  - 「既知の制約 / TODO」から `opaqueredirect` 問題と cookie 依存に関する記述を削除。

### 新規ファイル

- なし（既存ファイル整理で完結）。

### 破壊的変更

- **既存の login 済みユーザー（cookie-mode で取得した refresh family）は強制再ログインが必要**。理由: AuthCore 側で `transport の混在禁止` ルールがあり、cookie-mode で発行された refresh family を body-mode の refresh request で使うと再利用検知 / 拒否される可能性が高い。
  - 移行手順: 拡張アップデート時の `chrome.runtime.onInstalled`（`reason: 'update'`）で `clearAuthState()` + `chrome.cookies.remove({ url, name: 'refresh_token' })` を一回だけ実行し、ユーザーに「再ログインしてください」を表示する。`auth-manager.ts` の `init()` 改修と合わせて実装する。
  - 代替案: ストレージに `auth.transportMigrated: true` のようなフラグを置き、未設定なら強制 logout する。
- 旧仕様の AuthCore（cookie-mode 限定 / `opaqueredirect` 仕様）に対しては動作しない。AuthCore リリースとアトミックに揃える運用が必須。
- `PROVIDER_COMPLETE_CONNECT` メッセージ型の削除は内部 API の破壊的変更（外部消費者なし）。

## 実装ステップ

### Phase 0: 前提整備

1. PR #4 と本ブランチ `fix/hide-icon-on-fetch-error` のマージ完了を確認し、`develop` から新ブランチ `feat/extension-bearer-only-flow`（仮）を切る。
2. AuthCore 側の `support-extension-bearer-only-flow` がローカル / staging で稼働していることを確認。
3. signup+login 経路を本タスクに含めるかを決定する（**初期方針案: link 専用を維持。signup+login は別タスク**）。本ドキュメントは link 専用で書き、signup+login の追加要素は Phase 6（任意）にまとめる。

### Phase 1: 共通 client / 型 / storage の body-mode 化

4. `src/shared/auth/types.ts` の `TokenResponse` に `refresh_token: string` と `refresh_expires_in: number` を追加。`isPreTokenResponse` の判定はそのまま。
5. `src/shared/auth/client.ts` を改修:
   - `request()` の `headers` 既定値に `'X-Token-Delivery': 'body'` を必ず付ける（または各エンドポイント関数で個別付与）。
   - `RequestOptions` から `cookieHeader` を削除し、`Cookie` ヘッダ注入ロジックを削除。
   - `RefreshOptions` を `{ refreshToken: string | null }` に変更。
   - `refresh()` 実装: `body: { refresh_token: refreshToken }` で POST。`refreshToken` が null/空なら `AuthCoreApiError(401, TOKEN_REVOKED, 'No refresh token available')` を即時 throw。
   - `logout()` 実装: `body: { refresh_token: refreshToken }` で POST（refreshToken が null なら body は `{}` でもサーバ側 idempotent）。
   - `login` / `verifyMfa` は payload は変更不要、レスポンス型のみ更新。
6. `src/shared/auth/storage.ts`:
   - `AuthTokenSnapshot.refreshToken` を必須化、`setTokens` で常に両方保存するよう調整。または既存の optional のまま `persistTokenResponse` 側で必ず渡すように呼び出し側で担保する（破壊的変更を最小化したいなら後者）。
   - `getRefreshToken()` を追加:
     ```ts
     export async function getRefreshToken(): Promise<string | null> {
       const state = await getAuthState();
       return state.refreshToken;
     }
     ```
7. `src/shared/config.ts` から `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_PATH` を削除。

### Phase 2: auth-manager の cookie 撤去

8. `src/background/auth-manager.ts`:
   - `readRefreshCookie` / `buildCookieHeader` / `buildCookieUrl` を削除。
   - `persistTokenResponse` を以下に置き換え:
     ```ts
     async function persistTokenResponse(token: TokenResponse): Promise<number> {
       const payload = decodeJwt(token.access_token);
       await setTokens({
         accessToken: token.access_token,
         accessTokenExp: payload.exp,
         refreshToken: token.refresh_token,
       });
       await scheduleRefresh(token.expires_in);
       return payload.exp;
     }
     ```
   - `refreshTokens()` を以下に置き換え:
     ```ts
     refreshInflight = (async () => {
       try {
         const refreshToken = await getRefreshToken();
         if (!refreshToken) {
           throw new AuthCoreApiError(401, AuthErrorCode.TOKEN_REVOKED, 'No refresh token available');
         }
         const response = await refreshRequest({ refreshToken });
         await persistTokenResponse(response);
         return response;
       } finally {
         refreshInflight = null;
       }
     })();
     ```
   - `handleLogout()` を `const refreshToken = await getRefreshToken(); await logoutRequest({ refreshToken });` に変更。
   - `init()` 内の自動 refresh は変更不要（`refreshTokens()` が新形に置き換わるため）。
9. `src/shared/config.ts` の cookie 定数削除に伴うコンパイルエラーを潰す。

### Phase 3: 既存ユーザーの transport 移行（強制再ログイン）

10. `src/background/index.ts`（または service worker のエントリ）に `chrome.runtime.onInstalled` ハンドラを追加:
    ```ts
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason !== 'update') return;
      const previous = details.previousVersion;
      // 旧 cookie-mode で発行された refresh は body-mode で reuse するとサーバ側で
      // family 無効化される。古い state を全消去して強制再ログインを促す。
      await clearAuthState();
      try {
        if (chrome.cookies?.remove) {
          await chrome.cookies.remove({
            url: `${AUTHCORE_BASE_URL}/v1/auth`,
            name: 'refresh_token',
          });
        }
      } catch (error) {
        console.warn('[migration] failed to remove legacy cookie', error);
      }
    });
    ```
11. 移行版 release notes（`docs/overview.md` または README）に「アップデート後は再ログインが必要」と明記する。
12. 移行完了後（数バージョン後）に `chrome.cookies` permission を `manifest.json` から削除する旨を TODO として記録（このタスクでは即時削除しない方が安全。`onInstalled` で `chrome.cookies.remove` を呼ぶため当面 permission は残す）。

### Phase 4: provider connect の JSON 化

13. `src/shared/auth/providers.ts` の `getConnectAuthorizeUrl()` を以下に書き換え:
    ```ts
    export interface ConnectAuthorizeResponse {
      authorize_url: string;
      state: string;
    }

    export async function getConnectAuthorizeUrl(
      accessToken: string,
      provider: Provider,
      finalRedirect: string,
    ): Promise<string> {
      const params = new URLSearchParams({ final_redirect: finalRedirect });
      const url = `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}?${params.toString()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await parseBody(response);
      if (!response.ok) {
        throwApiError(response.status, body, `Failed to start provider connect (${response.status})`);
      }
      if (!isConnectAuthorizeResponse(body)) {
        throw new AuthCoreApiError(
          response.status,
          AuthErrorCode.INTERNAL_SERVER_ERROR,
          'AuthCore did not return an authorize URL',
        );
      }
      return body.authorize_url;
    }
    ```
    - `isConnectAuthorizeResponse(body)` 型ガード関数を同ファイル内に追加。
    - `redirect: 'manual'` / `response.type === 'opaqueredirect'` 関連を削除。
    - `credentials: 'include'` は body-mode では不要のため削除推奨。
14. `completeConnectCallback()` を削除。

### Phase 5: provider-manager / popup の callback 経路書き換え

15. `src/background/provider-manager.ts`:
    - `handleGetConnectUrl(provider)` を以下に変更:
      ```ts
      export async function handleGetConnectUrl(provider: Provider): Promise<{ authorizeUrl: string }> {
        const accessToken = await ensureAccessToken();
        const finalRedirect = chrome.identity.getRedirectURL('cb');
        const authorizeUrl = await getConnectAuthorizeUrl(accessToken, provider, finalRedirect);
        return { authorizeUrl };
      }
      ```
    - `handleCompleteConnect()` を削除。
16. `src/background/message-handler.ts` から `PROVIDER_COMPLETE_CONNECT` の case を削除。
17. `src/shared/auth/messages.ts`:
    - `AuthMessageType.PROVIDER_COMPLETE_CONNECT`、`AuthMessage` 判別共用体の該当ケース、`ProviderCompleteConnectPayload` / `ProviderCompleteConnectResponseData` を削除。
    - link 専用方針なので新規メッセージは追加しない。
18. `src/popup/auth/Dashboard.tsx`:
    - `extractCodeAndState` を `extractLinkResult` に置き換え:
      ```ts
      function extractLinkResult(redirectUrl: string): { provider: string; providerUserId: string } {
        const url = new URL(redirectUrl);
        // launchWebAuthFlow が返す URL の hash は `#linked=1&provider=x&provider_user_id=...`。
        // hash 先頭 `#` を除いた文字列を URLSearchParams に渡す。
        const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
        const linked = fragment.get('linked');
        if (linked !== '1') {
          // エラー fragment（`#error=...`）が返るケースを想定して別途処理。
          const errorCode = fragment.get('error');
          throw new Error(errorCode ? `Provider link failed: ${errorCode}` : 'Provider link did not complete');
        }
        const provider = fragment.get('provider');
        const providerUserId = fragment.get('provider_user_id');
        if (!provider || !providerUserId) {
          throw new Error('Authorization callback fragment is missing provider info');
        }
        return { provider, providerUserId };
      }
      ```
    - `handleConnect` の流れを「`getConnectUrl` → `launchWebAuthFlow` → `extractLinkResult` → 成功表示」に簡潔化。`PROVIDER_COMPLETE_CONNECT` の二段目を削除。
    - 連携成功後、popup 側で表示中の user 情報を refresh するため `useAuth` の `refresh()` を呼ぶか、`/v1/user/profile` を background 経由で再取得して表示更新（任意）。

### Phase 6: signup+login 経路（任意・本タスクのスコープ外推奨）

19. **本タスクのスコープからは外す**ことを推奨。理由: 本拡張は PR #4 から「link 専用」方針で進めており、signup+login UI（プロバイダボタンを未ログイン状態で出す等）の設計が別途必要。
20. もし含める場合の追加要素:
    - login 画面に「X でログイン / Google でログイン」ボタンを追加。
    - `handleGetConnectUrl` を未認証でも呼べるように `ensureAccessToken` を optional 化（Authorization ヘッダ無しで `getConnectAuthorizeUrl` を呼べるようにする）。
    - `extractFragment` を拡張し、signup+login モードの fragment（`access_token=...&refresh_token=...`）を検出して新メッセージ `PROVIDER_CONSUME_TOKENS` で background に渡す。
    - background 側で受け取った tokens を `persistTokenResponse` 相当で保存し、`/v1/user/profile` を取得して `setUser` する。
    - `EXTENSION_REDIRECT_ALLOW_LIST` の登録運用が必要。
21. signup+login を別タスク化する場合は新規 `docs/tasks/support-provider-signup-login.md` を切る。

### Phase 7: ドキュメント更新

22. `docs/overview.md`:
    - 「メッセージプロトコル」表の `PROVIDER_GET_CONNECT_URL` を「Bearer + `final_redirect` で JSON から authorize URL を取得（body-mode）」に更新。
    - `PROVIDER_COMPLETE_CONNECT` 行を削除。
    - 「ストレージ」セクションで `auth.refreshToken` の保存元を「Set-Cookie 経由」から「login/refresh/mfa-verify レスポンス body」に書き直す。
    - 「既知の制約 / TODO」から `opaqueredirect` / cookie 依存の項目を削除。
23. `docs/tasks/integrate-fuju-auth-and-provider-login.md` の関連箇所に「本タスクで body-mode 化により解消」追記（履歴目的）。

### Phase 8: 動作検証

24. ローカル AuthCore（body-mode 対応版）に対し以下を確認:
    - identifier + password ログイン → `chrome.storage.local.auth.refreshToken` に値が保存されること（cookie には保存されないこと）。
    - access_token 期限切れ後 / 強制 refresh 実行で body-mode refresh が成功すること。`chrome.cookies` API を呼ばないこと（DevTools の Network で確認）。
    - logout で `Successfully logged out` を受け取り、storage と alarms が完全クリアされること。
    - MFA 必須ユーザーで TOTP 検証 → body-mode token が返ること。
    - X / Google 連携: popup ボタン押下 → JSON で authorize URL 取得 → `launchWebAuthFlow` → fragment `#linked=1&...` 受領 → 成功表示。
    - 二重連携時のサーバ側エラーが popup で適切に表示されること。
    - ユーザーキャンセル時の挙動が既存通り。
    - 旧バージョンからのアップデートシナリオ: `chrome.runtime.onInstalled('update')` で storage がクリアされ、popup が LoginForm に戻ること。
25. content script 側の Fuju ユーザー判定 / アイコン挿入が従来通り動作することを確認。

## テスト要件

### 機能テスト

- body-mode login で `refresh_token` が `chrome.storage.local` に保存される。
- `/v1/auth/refresh` が `{ refresh_token }` body 付きで送られる。`Cookie` ヘッダが送られないこと（Network 監視）。
- `/v1/auth/logout` が body 付きで送られ、idempotent に成功する。
- `/v1/auth/connect/{provider}?final_redirect=...` が `Accept: application/json` + Bearer で叩かれ、JSON が返る。
- `launchWebAuthFlow` の終了 URL に `#linked=1&provider=...&provider_user_id=...` fragment が乗っており、popup が正しく抽出する。
- 旧 cookie-mode ユーザーがアップデートを受けると一回だけ強制 logout 状態になる。

### 既存フローの非破壊性

- identifier + password login、TOTP MFA、自動 refresh、logout が動作する。
- content script の Fuju ユーザー判定 / アイコン挿入が動作する。
- `AuthMessage` 判別共用体に対する型 narrowing が壊れていない（TypeScript ビルド OK）。

### 回帰チェック

- `getConnectAuthorizeUrl` 内で `opaqueredirect` 検出 / `redirect: 'manual'` が完全削除されていること（Grep）。
- `auth-manager.ts` から `chrome.cookies` 呼び出しが消えていること（Grep）。
- `config.ts` から `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_PATH` が消えていること。
- `messages.ts` に `PROVIDER_COMPLETE_CONNECT` が残っていないこと。
- `client.ts` の全認証エンドポイントで `X-Token-Delivery: body` が付与されていること。

## 技術的な補足

### transport 混在禁止と移行戦略

AuthCore 側で「同一 refresh family 内で transport を切り替えるのは禁止」と明記されている。本拡張は PR #4 までの cookie-mode 出荷版でユーザーが認証済みの可能性があるため、**body-mode 化バージョンの初回起動で必ず一度 storage と cookie の双方をクリアして再ログインを促す**。中途半端な互換維持（古い refresh をそのまま body で送る）は family 無効化のリスクを生む。

### `chrome.cookies` permission の扱い

Phase 3 の移行コードで `chrome.cookies.remove` を呼ぶため、`manifest.json` から `cookies` permission を即時削除しない。本タスクの範囲では permission は維持し、移行が完了した後続バージョン（数リリース後）で削除する TODO を残す。

### `final_redirect` の許可リスト登録

AuthCore 側 `EXTENSION_REDIRECT_ALLOW_LIST` に拡張機能 ID 由来の `https://<extension-id>.chromiumapp.org/cb` を登録する運用タスクが必要。link 専用フローでもサーバ側で `final_redirect` を完全一致検証するため、未登録の状態では callback で 400 が返る。Chrome Web Store 公開後の拡張 ID を確定させてから登録する手順を運用ドキュメントに追記する。

### `credentials: 'include'` の扱い

body-mode では cookie を送受信する必要がないため、各 fetch から `credentials: 'include'` を外しても機能上は問題ない。ただし CORS preflight の許可ヘッダ設定によっては挙動が変わる可能性があるため、Phase 1 では維持し、Phase 8 検証で動作確認後に削除を検討する。

### fragment の安全性

`launchWebAuthFlow` の closed-context redirect 先（`https://<extension-id>.chromiumapp.org/...`）は Chrome 内部で完結し、外部に漏れない。fragment はサーバログ・Referer ヘッダにも残らないため、body-mode の refresh_token 配送経路として安全（OAuth 2.0 Implicit Flow と同パターン）。

### 関連既存コード（参照）

- `src/shared/auth/client.ts` — 認証 fetch の中央。`X-Token-Delivery: body` 注入と `cookieHeader` 撤去の主戦場。
- `src/shared/auth/storage.ts` — `chrome.storage.local` I/O。`getRefreshToken` 追加。
- `src/shared/auth/tokens.ts` — JWT 期限判定。変更不要。
- `src/background/auth-manager.ts` — cookie ロジック撤去とリフレッシュ書き換えの主戦場。
- `src/shared/auth/providers.ts` — connect の JSON 化と `completeConnectCallback` 削除。
- `src/background/provider-manager.ts` — `handleCompleteConnect` 削除と `final_redirect` 注入。
- `src/popup/auth/Dashboard.tsx` — `extractCodeAndState` を fragment 抽出に書き換え。
- `src/shared/config.ts` — cookie 定数削除。
- `public/manifest.json` — cookies permission の扱い（即時削除はしない）。

## 既知の確認事項（実装前に確認）

1. **AuthCore デプロイ状態**: ローカル / staging で `X-Token-Delivery: body` 対応版が稼働していること。
2. **CORS**: `Access-Control-Allow-Headers` に `X-Token-Delivery` が追加されていること（仕様書には明記済み、実機確認必須）。
3. **EXTENSION_REDIRECT_ALLOW_LIST**: 拡張機能 ID 由来の `https://<extension-id>.chromiumapp.org/cb` が登録されていること。未登録なら link フローが 400 で失敗する。
4. **signup+login の取り扱い**: 本タスクは link 専用に絞る方針（Phase 6 はスコープ外）。signup+login が必要な場合は別タスクとして切る。
5. **既存ユーザーの強制再ログイン**: Phase 3 の `onInstalled('update')` 移行コードを必ず実装する。実装漏れがあると本番ユーザーが「サイレントに refresh 失敗 → 401 ループ」状態に陥る。
