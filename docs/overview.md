# fuju-ext プロジェクト概要

このドキュメントは、新規参加する開発者がリポジトリの全体像を短時間で把握できるように、
現状の実装サマリをまとめたものです。新たな仕様判断や設計提案は含めず、
**コードに書かれていることを「何が・どこに・なぜ」で要約する**スタンスです。
個別の設計議論は `docs/tasks/*.md` を参照してください。

## 目的

`fuju-ext` は、X（旧 Twitter）のタイムライン上で **Fuju ユーザーかどうかを示すアイコンを
ツイートのユーザー名に差し込む**Chrome 拡張機能（Manifest V3）です。利用ユーザーは
[AuthCore](../README.md) で認証してから拡張機能を使うことを想定しており、
popup から AuthCore のアカウントでログイン（必要に応じて TOTP MFA）して使います。

> Fuju ユーザー判定は AuthCore の `/v1/users/lookup?provider=x&q=<handle>` を叩き、
> レスポンス `{ exists: boolean }` で「Fuju ユーザーかどうか」のみを判定します。
> アイコン URL や詳細情報の取得は本タスクのスコープ外です。詳細は「既知の制約」を参照。

## 構成

Manifest V3 の 3 サーフェスをすべて使います。

- **popup** (`src/popup/`)
  React 19 で実装したログイン UI。AuthCore に直接 fetch するのではなく、
  認証関連の操作はすべて background service worker に message passing で委譲します。
- **background service worker** (`src/background/`)
  認証ライフサイクル（ログイン / MFA verify / refresh / logout / プロファイル取得）と
  トークンの永続化、自動リフレッシュのスケジューリングを集約します。
  popup / 外部からの message を `chrome.runtime.onMessage` で受けてディスパッチします。
- **content script** (`src/content/`)
  `x.com` / `twitter.com` でツイート要素を MutationObserver で監視し、
  ユーザー名の横に Fuju アイコンを差し込みます。

## 主要機能

### 認証（AuthCore 連携）

- 通常ログインと TOTP MFA に対応。詳細な実装方針はそれぞれのタスク資料を参照:
  - [`docs/tasks/implement-login-with-persistence.md`](./tasks/implement-login-with-persistence.md)
  - [`docs/tasks/support-mfa-login.md`](./tasks/support-mfa-login.md)
- popup の `LoginForm` で identifier（メールまたは公開 ID）/ password を入力し、
  background が `/v1/auth/login` を呼びます (`src/shared/auth/client.ts`)。
- レスポンスが `PreTokenResponse`（`mfa_required: true`）だった場合は popup が
  `MfaForm` に切り替わり、6 桁の TOTP コードで `/v1/auth/mfa/verify` を完了させます。
- access token / accessTokenExp / user は `chrome.storage.local` に永続化され、
  ブラウザ再起動後もログインが維持されます (`src/shared/auth/storage.ts`)。
- `chrome.alarms` で `expires_in - 60s` 前に自動リフレッシュをスケジュール
  (`src/background/auth-manager.ts` の `scheduleRefresh`)。
- ログアウトは `/v1/auth/logout` を呼び、ストレージとアラームをクリアします。

### コンテンツスクリプト（Fuju アイコン表示）

- `src/content/index.ts` が `location.href` のホスト名を見て `x.com` / `twitter.com`
  のときだけ `src/content/x/index.ts` を起動します。
- `src/content/x/index.ts` で `[data-testid="tweet"]` を `MutationObserver` 監視
  （`childList` + `subtree` + `attributes`）し、見つかったツイート要素を順次処理。
- 各ツイート内の `[data-testid="User-Name"]` の直下にアイコン用 `<div>` を
  **2 番目の子の前に** `insertBefore` で差し込みます (`src/content/x/userData.ts`
  の `insertFujuIcon`)。
- 重複挿入は `dataset.inserted` で抑止し、進行中状態は `dataset.loading` で
  追跡します。
- Fuju ユーザー判定は `src/content/api/fujuUserCache.ts` の `fujuData(userId)` が担当。
  - メモリ上の `Map` ベースキャッシュで同一ユーザーの重複 fetch を回避。
  - 同一 userId の進行中リクエストは `pendingRequests` Map で 1 本に共有。
  - 取得は `fetch(${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=<userId>)`。
    レスポンスは `{ exists: boolean }` で、404 は `{ exists: false }` として扱い、
    ネットワーク失敗は `null`（結果不明）として扱います。
- ローディング中は自前 SVG アイコン (`src/content/img/loadingIcon.ts` の
  `createLoadingIcon`) を `opacity: 0.5` で表示し、解決後に
  `dataset.fujuUserId` と `opacity` を更新します。

## ディレクトリ構成

```
src/
  background/
    index.ts             service worker エントリ。alarm/message ハンドラ登録と init 呼び出し
    auth-manager.ts      トークン永続化、refresh、MFA pre_token (memory only)、alarm スケジュール
    provider-manager.ts  /v1/auth/connect/{provider} 系の link 用ハンドラ（X / Google）
    message-handler.ts   chrome.runtime.onMessage のディスパッチと sender 検証
  content/
    index.ts             ホスト名で X 用ロジックを起動するエントリ
    x/index.ts           [data-testid="tweet"] の MutationObserver 監視と起動
    x/userData.ts        ツイート要素ごとに User-Name 直下へ Fuju アイコンを差し込む
    img/loadingIcon.ts   ローディング表示用の自前 SVG アイコン生成
    api/fujuUserCache.ts /v1/users/lookup の fetch + キャッシュ + in-flight 共有（exists 判定）
  popup/
    main.tsx             React のルート
    App.tsx              AuthProvider でラップし AuthGate で画面分岐
    auth/AuthProvider.tsx  background と message passing して認証状態を保持
    auth/auth-context.ts   React Context 定義
    auth/useAuth.ts        Context を取り出すフック
    auth/LoginForm.tsx     identifier / password 入力 UI
    auth/MfaForm.tsx       TOTP 6 桁コード入力 UI（キャンセルボタン付き）
    auth/Dashboard.tsx     ログイン済みユーザーの表示、ログアウト、X / Google との連携ボタン
  shared/
    config.ts            AUTHCORE_BASE_URL（VITE_AUTHCORE_BASE_URL から読込）
    auth/
      types.ts           User / TokenResponse / PreTokenResponse / MfaChallenge などの型
      errors.ts          AuthErrorCode 定数 と AuthCoreApiError クラス
      messages.ts        AuthMessageType と AuthMessage / AuthResponse 型 + isAuthMessage 型ガード
      tokens.ts          JWT payload デコードと isExpired
      storage.ts         chrome.storage.local の薄いラッパー（access token / user 等）
      client.ts          AuthCore REST クライアント（login / verifyMfa / refresh / logout / getProfile）
      providers.ts       provider 種別と /v1/auth/connect・/v1/auth/callback 用の link 専用クライアント
public/
  manifest.json          Manifest V3 宣言
  _locales/<lang>/messages.json  Chrome 拡張 i18n リソース（manifest 表示用）
popup.html               popup の Vite エントリ
```

## メッセージプロトコル（popup ↔ background）

`src/shared/auth/messages.ts` で型安全に定義されています。

| `AuthMessageType` 値（定数）                | 文字列値                    | 用途                                                                             |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `AuthMessageType.LOGIN`                     | `AUTH_LOGIN`                | identifier/password でログイン。MFA 必要時は `mfa_required` を返す               |
| `AuthMessageType.MFA_VERIFY`                | `AUTH_MFA_VERIFY`           | 保持中の `pre_token` と TOTP コードで MFA を完了                                 |
| `AuthMessageType.MFA_CANCEL`                | `AUTH_MFA_CANCEL`           | 保持中の `pre_token` を破棄して LoginForm に戻る                                 |
| `AuthMessageType.LOGOUT`                    | `AUTH_LOGOUT`               | サーバへ logout、ストレージとアラームをクリア                                    |
| `AuthMessageType.GET_STATE`                 | `AUTH_GET_STATE`            | 現在の `AuthState`（`user` / `isAuthenticated`）を取得                           |
| `AuthMessageType.REFRESH`                   | `AUTH_REFRESH`              | 即時リフレッシュをトリガ                                                         |
| `AuthMessageType.FETCH`                     | `AUTH_FETCH`                | access token を付けた認証付き fetch を background 経由で実行                     |
| `AuthMessageType.PROVIDER_GET_CONNECT_URL`  | `PROVIDER_GET_CONNECT_URL`  | Bearer + `final_redirect` で `/v1/auth/connect/{provider}` の JSON から authorize URL を取得（body-mode） |

レスポンスは `AuthResponse<T> = { ok: true; data: T } | { ok: false; error: AuthErrorPayload }`。

### sender 検証

`src/background/message-handler.ts` の `isTrustedSender` で、

- `sender.id !== chrome.runtime.id` の message は拒否（他拡張からの呼び出し排除）
- `sender.tab !== undefined` の message も拒否（content script / Web ページからの
  ログイン/ログアウト/fetch 駆動を排除）

としており、認証関連 API はこの拡張の popup や background 自身からのみ呼べます。
content script はこのチャネルでは認証要求を発行しません。

## ストレージとセキュリティ要点

- **永続化対象**: access token / accessTokenExp / refresh token / user。
  すべて `chrome.storage.local` に保存 (`src/shared/auth/storage.ts`)。
- **`pre_token` は memory only**:
  `auth-manager.ts` の `pendingMfa` 変数に保持し、`chrome.storage` には保存しません。
  Service worker の suspend/restart で消えるのは設計通りで、消えた場合の MFA verify は
  `MFA_NOT_PENDING` を返し、popup は `LoginForm` に戻します
  （`docs/tasks/support-mfa-login.md` の方針に準拠）。
- **refresh token の取り扱い**:
  本拡張は AuthCore に対し `X-Token-Delivery: body` を付けて全認証エンドポイントを
  呼び出し、`refresh_token` を JSON body で授受する body-mode で動作します
  (`src/shared/auth/client.ts`)。受信した `refresh_token` は login / refresh /
  mfa-verify の各レスポンス body から `chrome.storage.local` に保存されます
  (`auth-manager.ts` の `persistTokenResponse`)。`chrome.cookies` への依存は
  撤廃済み（移行用に Phase 3 の `onInstalled('update')` で legacy cookie を
  一度だけ削除する用途のみ残置）。
- **Refresh の並行発火制御**:
  AuthCore の Refresh Token Rotation は同一 family で有効な refresh は 1 本のみ。
  複数発火すると再利用検知で family 全体が無効化されるため、`refreshInflight`
  プロミスで in-flight を 1 本に共有しています (`refreshTokens`)。
- **自動リフレッシュ**:
  `chrome.alarms.create('auth.refresh', ...)` で `expires_in - 60s` 前に発火
  （最低 0.5 分）。`registerAlarmHandler` がリスナを登録し、失敗時はエラーを
  warn してから `clearAuthState` でログアウト状態に戻します。
- **401 リトライ**:
  `authenticatedFetch` は 401 を受けたら 1 回だけ refresh→ 再 fetch を試み、
  失敗したら `clearAll` でログアウトします。

## ビルドと配布

- **開発**: `npm run dev`（Vite watch + development mode）。
- **本番ビルド**: `npm run build` = `tsc -b && vite build`。`dist/` に出力。
- **ロード**: `chrome://extensions` で Developer Mode を有効にし、`dist/` を
  unpacked extension として読み込みます。
- **その他のスクリプト**:
  - `npm run lint` / `npm run lint:fix` — ESLint
  - `npm run format` — `lint:fix` と Prettier
- `public/` 配下のファイルは Vite の標準動作で `dist/` 直下にコピーされます
  （`public/manifest.json` → `dist/manifest.json`、`public/_locales/` →
  `dist/_locales/`）。

## 環境変数

`.env.example` をコピーして `.env` を作成してから利用します。

| 変数名                   | デフォルト              | 用途                                                   |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| `VITE_AUTHCORE_BASE_URL` | `http://localhost:8080` | popup / background が AuthCore REST API を呼ぶ際の URL |

`AUTHCORE_BASE_URL` は `src/shared/config.ts` で末尾スラッシュを除去して読み込みます。
未設定時は上記デフォルトにフォールバックします。

## 既知の制約 / TODO

- **拡張機能 ID とオリジンの管理**: unpacked install と Web Store 公開版で
  拡張機能 ID（`chrome-extension://<id>`）が変わるため、AuthCore 側の
  `ALLOWED_ORIGINS`（CORS allow-list）に必要な origin を追加する運用が必要です。
  詳細は `README.md` の "AuthCore integration notes" を参照。
- **provider 連携の未対応領域**:
  - **provider 経由の新規ユーザー登録**は未実装（X は `SOCIAL_LINK_ONLY` のため不可、
    Google はサインアップ動線が大きいため別タスク）。
  - **provider disconnect UI / API 配線**は未実装（別タスク）。
  - **Fuju ユーザーのアイコン URL や詳細情報の取得**は未実装。`/v1/users/lookup` は
    `{ exists: boolean }` のみを返すため、avatar 等の取得には別 API 設計が必要。
- **popup UI の文言は日本語ハードコード**:
  `LoginForm.tsx` / `MfaForm.tsx` / `Dashboard.tsx` / `App.tsx` のローディング
  メッセージなどはすべて日本語で直書きされており、`chrome.i18n` には乗っていません。
  manifest 表示名のみ i18n 化済み（本タスクで対応）。popup UI の i18n は別タスク。
- **`MFA_NOT_SUPPORTED` の deprecated 残置**:
  MFA 対応後は到達しないコードパスになりましたが、`AuthErrorCode` 定数自体は
  互換維持のため残置されています（`docs/tasks/support-mfa-login.md` 確定事項）。
- **recovery code / WebAuthn 未対応**:
  TOTP のみ対応。recovery code 入力 UI や WebAuthn / Passkey は未実装です
  （`docs/tasks/support-mfa-login.md` 「対象外」参照）。
- **content script のログ出力**:
  `console.log` が複数残っており、production でも出力されます。
- **`chrome.cookies` permission の残置**:
  認証フローは body-mode 化により cookie に依存しませんが、`onInstalled('update')`
  での legacy cookie 削除コードのために `manifest.json` の `cookies` permission を
  当面残しています。移行が完了した後続バージョンで削除する想定です
  （`docs/tasks/support-extension-bearer-only-flow.md` Phase 3）。
- **`EXTENSION_REDIRECT_ALLOW_LIST` の登録運用**:
  provider 連携の `final_redirect=https://<extension-id>.chromiumapp.org/cb` は
  AuthCore 側の `EXTENSION_REDIRECT_ALLOW_LIST` で完全一致検証されるため、
  拡張機能 ID を確定させた上でサーバ側に登録する運用が必要です。未登録だと
  link フローが 400 で失敗します。

## 関連ドキュメント

- [`README.md`](../README.md) — セットアップ手順 / Project layout / AuthCore 連携の注意
- [`docs/tasks/implement-login-with-persistence.md`](./tasks/implement-login-with-persistence.md)
  — ログイン基盤と永続化の設計記録
- [`docs/tasks/support-mfa-login.md`](./tasks/support-mfa-login.md)
  — TOTP MFA フロー追加の設計記録

---

最終更新の起点コミット: `e933bc7`（2026-05-02 時点）。
コードに変更があった場合はこのドキュメントも追従更新してください。
