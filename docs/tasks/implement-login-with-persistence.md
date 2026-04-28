# AuthCore 連携ログイン機能の実装（永続化対応）

## 概要

AuthCore (`../auth/docs/*`) の認証 API と連携し、ブラウザ拡張機能 (Manifest V3) の popup でログイン UI を提供する。アクセストークン／リフレッシュトークンを `chrome.storage.local` に永続化し、ブラウザ再起動後もログイン状態を維持する。トークン管理は background service worker に集約し、popup / content script からは message passing でアクセスする。

## 背景・目的

- 現状の拡張機能 (`fuju-extension`) は popup に Vite テンプレートのカウンタが表示されるのみで、認証機能を持たない。
- 拡張機能の各機能（content script でのフォーム自動入力、ユーザー固有設定の取得など）は AuthCore で発行されるアクセストークンで認証された API 呼び出しを前提とするため、ログイン基盤が不可欠。
- ユーザー体験上、毎回ログインを求めるのは現実的ではないため、**ブラウザを再起動してもログインが維持される**永続化が必要。
- AuthCore のリフレッシュトークンは HttpOnly cookie + `Path=/v1/auth` 配送が標準仕様だが、拡張機能の popup/background は origin が `chrome-extension://<id>` のため cookie が自動付与されない。本タスクでこの差分を埋めるための拡張機能側のトークン管理戦略を確立する。

## 影響範囲

新規追加が中心で、既存コードへの破壊的変更はない（popup の `App.tsx` をログイン UI に置き換える程度）。

### 新規追加

- `src/shared/auth/` — 認証共通モジュール（API クライアント、型定義、ストレージラッパー、メッセージプロトコル）
  - `client.ts` — AuthCore REST クライアント (`login`, `refresh`, `logout`, `getProfile`)
  - `storage.ts` — `chrome.storage.local` ラッパー（access/refresh トークンと expiry の保存・取得・削除）
  - `tokens.ts` — JWT デコード（payload `exp` 抽出）と有効期限判定ユーティリティ
  - `messages.ts` — popup/content ↔ background 間で交換する `chrome.runtime.Message` の型と定数
  - `types.ts` — `User`, `TokenResponse`, `LoginRequest` 等の型定義（AuthCore README §6 に準拠）
  - `errors.ts` — AuthCore エラーコード (`INVALID_CREDENTIALS`, `TOKEN_EXPIRED` など) の型と判定ヘルパ
- `src/shared/config.ts` — `AUTHCORE_BASE_URL` 等の環境設定（`import.meta.env.VITE_AUTHCORE_BASE_URL` から読込）
- `src/background/auth-manager.ts` — トークンライフサイクル管理（永続化、`/v1/auth/refresh` 呼び出し、自動更新スケジューリング、ログアウト処理）
- `src/background/message-handler.ts` — `chrome.runtime.onMessage` のディスパッチ（`AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_GET_STATE`, `AUTH_FETCH` 等）
- `src/popup/auth/` — popup 側のログイン UI
  - `LoginForm.tsx` — identifier/password 入力、送信、エラー表示
  - `AuthProvider.tsx` — React Context で認証状態を提供（background から状態取得）
  - `useAuth.ts` — `login`, `logout`, `user`, `isAuthenticated`, `loading` を返すフック
- `.env.example` — `VITE_AUTHCORE_BASE_URL` のテンプレート

### 既存ファイルの変更

- `src/background/index.ts` — `auth-manager` と `message-handler` を初期化する起動コードを追加
- `src/popup/App.tsx` — テンプレートを置き換え、`AuthProvider` でラップして認証状態に応じて `LoginForm` または既存 UI を出し分け
- `src/popup/main.tsx` — 変更なし（`AuthProvider` は `App.tsx` 内で使用）
- `public/manifest.json` — 以下を追加
  - `permissions`: 既存 `storage`, `activeTab` に `cookies` を追加（リフレッシュトークン cookie の読み出しに必要。詳細は §技術的補足参照）
  - `host_permissions`: AuthCore のオリジン（例 `https://auth.example.com/*`）を追加
- `package.json` — 必要に応じて `jose`（JWT デコード用、軽量）を追加。標準 `atob` で十分なら不要。
- `vite.config.ts` — 変更なしで動作する想定（`src/shared` は通常の TS 解決で読まれる）

### 破壊的変更

なし（新規機能の追加。popup の見た目は変わるがユーザー向け機能はまだないため影響なし）。

## 実装ステップ

### Phase 1: 共通モジュールと型定義

1. `src/shared/auth/types.ts` を作成し、AuthCore README §6 の型を TS 化する。
   - `LoginRequest = { identifier: string; password: string }`
   - `TokenResponse = { access_token: string; token_type: 'Bearer'; expires_in: number }`
   - `PreTokenResponse = { pre_token: string; mfa_required: true; token_type: 'Bearer'; expires_in: number }`
   - `User = { id: string; email: string; public_id: string; mfa_enabled: boolean; icon_url: string | null; created_at: string }`
   - `AuthCoreError = { error: string; message: string }`
2. `src/shared/auth/errors.ts` でエラーコード定数 (`INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `MFA_REQUIRED`, `RATE_LIMIT_EXCEEDED` 等) を const enum 風の object として定義し、`isAuthCoreError(res): res is AuthCoreError` を実装。
3. `src/shared/config.ts` で `AUTHCORE_BASE_URL` を `import.meta.env.VITE_AUTHCORE_BASE_URL` から取得（未設定時はデフォルト `http://localhost:8080`）。
4. `src/shared/auth/tokens.ts` に JWT payload デコーダ (`decodeJwt(token): { sub: string; exp: number; iat: number; type: string; ... }`) と `isExpired(token, skewSeconds = 30)` を実装。署名検証はサーバ任せでクライアントはペイロード読みのみ。

### Phase 2: ストレージとメッセージプロトコル

5. `src/shared/auth/storage.ts` を作成。`chrome.storage.local` を Promise でラップし、以下のキーを管理:
   - `auth.accessToken` (string)
   - `auth.refreshToken` (string) — 後述の通り cookie から読み出した値、または AuthCore からボディで受け取った値を格納
   - `auth.accessTokenExp` (number, UNIX 秒)
   - `auth.user` (User)
   - API: `getAuthState()`, `setTokens(tokens)`, `setUser(user)`, `clear()`
6. `src/shared/auth/messages.ts` で background との通信メッセージ型を定義:
   ```ts
   type AuthMessage =
     | { type: 'AUTH_LOGIN'; payload: LoginRequest }
     | { type: 'AUTH_LOGOUT' }
     | { type: 'AUTH_GET_STATE' }
     | { type: 'AUTH_REFRESH' }
     | { type: 'AUTH_FETCH'; payload: { path: string; init?: RequestInit } };
   ```
   それぞれのレスポンス型 `AuthResponse` も定義。

### Phase 3: AuthCore クライアント（fetch ラッパー）

7. `src/shared/auth/client.ts` で `fetch` ベースのクライアントを実装。
   - `login({ identifier, password })`: `POST /v1/auth/login`、`credentials: 'include'`、レスポンスに `pre_token` フラグがあれば MFA 要求（本タスクでは未対応として明示的に未実装エラーを返す）。成功時は `TokenResponse` を返す。
   - `refresh()`: `POST /v1/auth/refresh`、`credentials: 'include'`。**拡張機能では cookie が自動送信されないため、background から `chrome.cookies.get` で取得した refresh_token を `Cookie` ヘッダに手動付与**する（§技術的補足参照）。
   - `logout()`: `POST /v1/auth/logout`、同上。
   - `getProfile(accessToken)`: `GET /v1/user/profile`、`Authorization: Bearer <accessToken>`。
   - すべて 4xx/5xx 時に `AuthCoreError` を throw する `AuthCoreApiError` クラスを使用。

### Phase 4: background での auth-manager とメッセージハンドラ

8. `src/background/auth-manager.ts` を実装。
   - `init()`: 起動時に `chrome.storage.local` から状態を読み、`accessToken` の `exp` を確認。期限内ならそのまま、期限切れなら `refresh()` を試行し失敗時はログアウト状態にする。
   - `handleLogin(req)`: `client.login(req)` を呼び、成功後に `chrome.cookies.get({ url, name: 'refresh_token' })` で refresh token を取得し `chrome.storage.local` に保存。`getProfile` で User を取得して保存。次回更新の `chrome.alarms` を `expires_in - 60s` でセット。
   - `handleRefresh()`: 保存済み refresh_token を `Cookie` ヘッダに乗せて `/v1/auth/refresh` を呼び、新しい access_token と（rotate された）refresh_token を保存。失敗時は `clear()` してログアウト状態へ。
   - `handleLogout()`: `client.logout()` を呼び、`chrome.storage.local.clear()` 関連キー削除、`chrome.alarms.clear`。
   - `chrome.alarms.onAlarm` で auto-refresh をトリガー。
9. `src/background/message-handler.ts` で `chrome.runtime.onMessage` を購読し、メッセージタイプごとに `auth-manager` の関数へ委譲。`sendResponse` を使って async 応答を返すため `return true` を忘れない。
10. `src/background/index.ts` を更新し、`onInstalled` / 起動時 (`chrome.runtime.onStartup`) に `authManager.init()` を呼ぶ。`message-handler.register()` も呼ぶ。

### Phase 5: popup 側のログイン UI

11. `src/popup/auth/AuthProvider.tsx` を実装。マウント時に background へ `AUTH_GET_STATE` を送り、`{ user, isAuthenticated, loading }` を Context で提供。`chrome.storage.onChanged` を購読して state 変化を反映。
12. `src/popup/auth/useAuth.ts` で Context をラップし、`login(identifier, password)` / `logout()` を `chrome.runtime.sendMessage` 経由で呼ぶフックを返す。
13. `src/popup/auth/LoginForm.tsx` を実装。identifier (email or public_id) / password の入力欄、送信ボタン、エラー表示 (`INVALID_CREDENTIALS` → "メールアドレス/公開IDまたはパスワードが間違っています" 等のローカライズ)、ローディング状態を扱う。MFA 要求時は本タスクではエラーメッセージで明示。
14. `src/popup/App.tsx` を更新し、`<AuthProvider>` 配下で `isAuthenticated ? <Dashboard /> : <LoginForm />` を出し分け。`Dashboard` は最小実装（"Logged in as {public_id}" + ログアウトボタン）でよい。

### Phase 6: マニフェストと環境変数

15. `public/manifest.json` の `permissions` に `cookies`、`host_permissions` に `https://auth.example.com/*`（`.env` 由来のドメインに合わせる。複数環境用に `*.example.com` も検討）を追加。
16. `.env.example` を新規作成し `VITE_AUTHCORE_BASE_URL=http://localhost:8080` を記述。`.gitignore` に `.env` が含まれることを確認。
17. `vite.config.ts` のエントリポイント設定が現状のまま動くか確認（`src/shared` は popup / background 双方からインポートされるが、Vite は自動でバンドルする）。

### Phase 7: 動作検証

18. AuthCore をローカル起動 (`http://localhost:8080`) し、`/v1/auth/register` でテストユーザーを作成。
19. 拡張機能をビルド (`npm run build`) し Chrome の `chrome://extensions` で `dist/` を読み込む。
20. popup でログイン → 状態保持 → popup を閉じて再度開く（永続化確認）→ Chrome を再起動して再度開く（ブラウザ再起動跨ぎの永続化確認）。
21. 15 分経過後にアクセストークン自動更新が動作することを確認（`chrome.alarms` ログ）。
22. `chrome.storage.local` を手動削除した場合に未ログイン状態に戻ることを確認。
23. ログアウトボタンで cookie 削除と storage クリアが両方行われることを確認。

## テスト要件

- **単体**: `tokens.ts` の `decodeJwt` / `isExpired`、`storage.ts` の get/set（`chrome.storage` をモック）、`client.ts` のレスポンス分岐（`fetch` をモック）。Vitest 等のテストランナー導入は本タスクの範囲外（必要なら別タスク化）。
- **手動 E2E**: Phase 7 の手順 18〜23。
- **エラーケース**: 不正な credentials で `INVALID_CREDENTIALS` がフォームに表示される。AuthCore 停止時にネットワークエラーが UI に出る。`token_family` 失効で 401 が返ったら自動ログアウトされる。

## 技術的な補足

### Refresh Token の cookie 配送と拡張機能の制約

AuthCore (README §3.7, §6.2) はリフレッシュトークンを `Set-Cookie: refresh_token=...; Path=/v1/auth; HttpOnly; Secure; SameSite=Lax` で配送する。拡張機能では以下に注意:

1. **`fetch(..., { credentials: 'include' })` は拡張機能 origin (`chrome-extension://<id>`) からの呼び出しに対しても、対象 URL のドメイン cookie に対して効く**。`host_permissions` に AuthCore のドメインを追加すれば fetch は自動で cookie を送受信する。
2. ただし `HttpOnly` cookie は JavaScript からは読めないため、background から `chrome.cookies.get({ url: AUTHCORE_BASE_URL + '/v1/auth', name: 'refresh_token' })` で**拡張機能の cookie 権限経由**で値を取り出して `chrome.storage.local` に保存する必要がある（バックアップ目的。fetch の自動送信が効くなら通常はこれで十分）。
3. `Path=/v1/auth` 制約により、cookie は `/v1/auth/*` にのみ送信される。`/v1/user/*` への access token 付き呼び出しは Bearer ヘッダだけで完結するため問題なし。
4. **代替案**: AuthCore に拡張機能向けの「refresh token を body で返すモード」を追加することも将来的に検討（現時点では cookie + `chrome.cookies` API で対応）。

`manifest.json` で必要な権限:
- `permissions`: `"storage"`, `"cookies"`
- `host_permissions`: AuthCore のオリジン（例 `"https://auth.example.com/*"`、開発時は `"http://localhost:8080/*"` も追加）

### MV3 Service Worker のライフサイクル

- background service worker は idle で停止するため、グローバル変数でのトークンキャッシュは消える。**必ず `chrome.storage.local` を sole source of truth とする**。
- 自動 refresh は `setTimeout` ではなく `chrome.alarms` を使う（worker が眠っていても起動する）。
- `chrome.runtime.onStartup` でブラウザ再起動時の初期化ハンドラを登録する。

### MFA は本タスク対象外

AuthCore は `pre_token` を返すケース（README §3.7 ステップ 2）があるが、本タスクの初期実装では MFA 設定済みユーザーへの対応は範囲外とする。`mfa_required: true` を受け取った場合は UI で「MFA 対応は未実装です」と表示し、ログインを中断する。MFA 対応は次タスクで実装する。

### CORS / `Access-Control-Allow-Credentials`

AuthCore 側で `ALLOWED_ORIGINS` に `chrome-extension://<extension-id>` を許可する必要がある（README §3.13）。**拡張機能の ID は開発時とストア配布時で変わる**ため、開発環境では `chrome-extension://*` を許可する設定オプションが必要かもしれない。AuthCore 側の設定変更が必要であることを README / 連携手順書に明記する。

### セキュリティ

- access token / refresh token は `chrome.storage.local` に平文で保存される（`chrome.storage.session` は MV3 でメモリ常駐だがブラウザ再起動で消えるため永続化要件を満たさない）。これは Chrome 拡張機能における事実上の標準だが、リスクとして記録しておく。
- popup と content script から直接トークンに触らせず、必ず `AUTH_FETCH` メッセージ経由で background に代行させる方針にすると、トークン漏洩リスクを最小化できる。

### 依存関係

- 新規 npm 依存: なし（`fetch`, `atob`, `chrome.*` API のみで完結する想定）。
  - JWT デコードを堅牢にしたい場合は `jose` (~50kb) を追加検討。
- AuthCore がローカルで起動できる環境（`docker-compose up`）が前提。
