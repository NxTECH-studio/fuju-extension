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

> Fuju ユーザー判定 API（`/api/fuju-user/<userId>`）の具体仕様は本リポジトリ外であり、
> エンドポイントの最終仕様は未確認です。詳細は「既知の制約」を参照。

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
- popup の `LoginForm` で identifier（メールまたは公開ID）/ password を入力し、
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
  - 取得は `fetch('/api/fuju-user/<userId>')`（X.com の同一オリジン相対パス）。
- ローディング中は自前 SVG アイコン (`src/content/img/loadingIcon.ts` の
  `createLoadingIcon`) を `opacity: 0.5` で表示し、解決後に
  `dataset.fujuUserId` と `opacity` を更新します。

## ディレクトリ構成

```
src/
  background/
    index.ts             service worker エントリ。alarm/message ハンドラ登録と init 呼び出し
    auth-manager.ts      トークン永続化、refresh、MFA pre_token (memory only)、alarm スケジュール
    message-handler.ts   chrome.runtime.onMessage のディスパッチと sender 検証
  content/
    index.ts             ホスト名で X 用ロジックを起動するエントリ
    x/index.ts           [data-testid="tweet"] の MutationObserver 監視と起動
    x/userData.ts        ツイート要素ごとに User-Name 直下へ Fuju アイコンを差し込む
    img/loadingIcon.ts   ローディング表示用の自前 SVG アイコン生成
    api/fujuUserCache.ts /api/fuju-user/<userId> の fetch + キャッシュ + in-flight 共有
  popup/
    main.tsx             React のルート
    App.tsx              AuthProvider でラップし AuthGate で画面分岐
    auth/AuthProvider.tsx  background と message passing して認証状態を保持
    auth/auth-context.ts   React Context 定義
    auth/useAuth.ts        Context を取り出すフック
    auth/LoginForm.tsx     identifier / password 入力 UI
    auth/MfaForm.tsx       TOTP 6 桁コード入力 UI（キャンセルボタン付き）
    auth/Dashboard.tsx     ログイン済みユーザーの表示とログアウト
  shared/
    config.ts            AUTHCORE_BASE_URL（VITE_AUTHCORE_BASE_URL から読込）と Cookie 定数
    auth/
      types.ts           User / TokenResponse / PreTokenResponse / MfaChallenge などの型
      errors.ts          AuthErrorCode 定数 と AuthCoreApiError クラス
      messages.ts        AuthMessageType と AuthMessage / AuthResponse 型 + isAuthMessage 型ガード
      tokens.ts          JWT payload デコードと isExpired
      storage.ts         chrome.storage.local の薄いラッパー（access token / user 等）
      client.ts          AuthCore REST クライアント（login / verifyMfa / refresh / logout / getProfile）
public/
  manifest.json          Manifest V3 宣言
  _locales/<lang>/messages.json  Chrome 拡張 i18n リソース（manifest 表示用）
popup.html               popup の Vite エントリ
```

## メッセージプロトコル（popup ↔ background）

`src/shared/auth/messages.ts` で型安全に定義されています。

| `AuthMessageType` 値（定数）        | 文字列値             | 用途                                                              |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------- |
| `AuthMessageType.LOGIN`             | `AUTH_LOGIN`         | identifier/password でログイン。MFA 必要時は `mfa_required` を返す |
| `AuthMessageType.MFA_VERIFY`        | `AUTH_MFA_VERIFY`    | 保持中の `pre_token` と TOTP コードで MFA を完了                  |
| `AuthMessageType.MFA_CANCEL`        | `AUTH_MFA_CANCEL`    | 保持中の `pre_token` を破棄して LoginForm に戻る                   |
| `AuthMessageType.LOGOUT`            | `AUTH_LOGOUT`        | サーバへ logout、ストレージとアラームをクリア                     |
| `AuthMessageType.GET_STATE`         | `AUTH_GET_STATE`     | 現在の `AuthState`（`user` / `isAuthenticated`）を取得            |
| `AuthMessageType.REFRESH`           | `AUTH_REFRESH`       | 即時リフレッシュをトリガ                                          |
| `AuthMessageType.FETCH`             | `AUTH_FETCH`         | access token を付けた認証付き fetch を background 経由で実行       |

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
  AuthCore は `Path=/v1/auth` の HttpOnly Cookie で refresh token を配送します。
  background は `chrome.cookies.get` で読み出して `chrome.storage.local` に
  バックアップし (`auth-manager.ts` の `readRefreshCookie` / `setRefreshToken`)、
  `chrome.cookies` から取得できないケース（MV3 の worker ライフサイクル）でも
  リフレッシュを継続できるようにします。Cookie が読めない場合は warn 出力のみ。
- **Refresh の並行発火制御**:
  AuthCore の Refresh Token Rotation は同一 family で有効な refresh は 1 本のみ。
  複数発火すると再利用検知で family 全体が無効化されるため、`refreshInflight`
  プロミスで in-flight を 1 本に共有しています (`refreshTokens`)。
- **自動リフレッシュ**:
  `chrome.alarms.create('auth.refresh', ...)` で `expires_in - 60s` 前に発火
  （最低 0.5 分）。`registerAlarmHandler` がリスナを登録し、失敗時はエラーを
  warn してから `clearAuthState` でログアウト状態に戻します。
- **401 リトライ**:
  `authenticatedFetch` は 401 を受けたら 1 回だけ refresh→再 fetch を試み、
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

| 変数名                     | デフォルト                | 用途                                                  |
| -------------------------- | ------------------------- | ----------------------------------------------------- |
| `VITE_AUTHCORE_BASE_URL`   | `http://localhost:8080`   | popup / background が AuthCore REST API を呼ぶ際の URL |

`AUTHCORE_BASE_URL` は `src/shared/config.ts` で末尾スラッシュを除去して読み込みます。
未設定時は上記デフォルトにフォールバックします。

## 既知の制約 / TODO

- **拡張機能 ID とオリジンの管理**: unpacked install と Web Store 公開版で
  拡張機能 ID（`chrome-extension://<id>`）が変わるため、AuthCore 側の
  `ALLOWED_ORIGINS`（CORS allow-list）に必要な origin を追加する運用が必要です。
  詳細は `README.md` の "AuthCore integration notes" を参照。
- **Fuju ユーザー判定 API**: `src/content/api/fujuUserCache.ts` の問い合わせ先は
  `fetch('/api/fuju-user/<userId>')` で **content script が走るオリジン
  （x.com / twitter.com）への相対 fetch** です。`host_permissions` には
  AuthCore 用の `http://localhost:8080/*` / `https://auth.example.com/*` と
  X.com 系の `https://x.com/*` / `https://*.x.com/*` が含まれており、この
  fetch は後者の範囲で送出されます。実際にこのパスがどのサーバへ届く想定か、
  およびレスポンス JSON の最終仕様はリポジトリ外で、本リポジトリのコード上では未確認です。
  現在は `data` をそのままキャッシュ値として保持し、null 以外なら「Fuju ユーザー」と
  判定する実装になっています。
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

## 関連ドキュメント

- [`README.md`](../README.md) — セットアップ手順 / Project layout / AuthCore 連携の注意
- [`docs/tasks/implement-login-with-persistence.md`](./tasks/implement-login-with-persistence.md)
  — ログイン基盤と永続化の設計記録
- [`docs/tasks/support-mfa-login.md`](./tasks/support-mfa-login.md)
  — TOTP MFA フロー追加の設計記録

---

最終更新の起点コミット: `e933bc7`（2026-05-02 時点）。
コードに変更があった場合はこのドキュメントも追従更新してください。
