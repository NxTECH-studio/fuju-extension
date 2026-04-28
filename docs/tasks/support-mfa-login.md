# MFA ログイン対応（pre_token フローの完了対応）

## 概要

AuthCore の `/v1/auth/login` が `PreTokenResponse`（`mfa_required: true`）を返した場合に、現状のように `MFA_NOT_SUPPORTED` で拒否するのではなく、`/v1/auth/mfa/verify` を呼び出して MFA を完了し、通常の `TokenResponse` 取得まで導く。popup UI に MFA コード入力画面を追加し、**TOTP（6 桁）のみに対応する**（recovery code は本タスクでは対象外）。

## 背景・目的

- 直前のタスク（[`implement-login-with-persistence.md`](./implement-login-with-persistence.md)）で AuthCore ログイン基盤を実装したが、MFA を有効化したユーザーは `pre_token` を受け取った段階で「MFA 対応は未実装です」と弾かれている (`src/background/auth-manager.ts` の `handleLogin()` 内で `AuthErrorCode.MFA_NOT_SUPPORTED` を throw)。
- AuthCore 仕様（[`../auth/docs/flows/password-login.md`](../../../auth/docs/flows/password-login.md), [`../auth/docs/api-summary.md §3.2`](../../../auth/docs/api-summary.md)）では、`PreTokenResponse` 受領後に `Authorization: Bearer <pre_token>` で `/v1/auth/mfa/verify` を叩き `TokenResponse + Set-Cookie: refresh_token` を取得するのが正規フロー。本タスクでこのフローを実装する。
- 拡張機能の本番ユーザーは MFA を有効化していることが想定されるため、MFA 対応抜きでログイン機能はリリース不可。

## 確定事項（ヒアリング結果）

以下はエンジニアとの確定事項。実装はこの方針に沿う。

1. **対応する MFA メソッド**: **TOTP（6 桁数字コード）のみ**。recovery code は本タスクでは対応しない（後述「対象外」参照）。
2. **pre_token の保管場所**: **background の in-memory のみ**（`chrome.storage.session` も含めて永続化はしない）。
3. **キャンセルボタン**: MFA 入力画面に明示的に設置する。
4. **`MFA_NOT_SUPPORTED` 定数**: **削除せず deprecated として残置**。利用箇所を明文化する（後述）。

## 対象外（本タスクではやらないこと）

- **recovery code の入力 UI / API 呼び出し**:
  - `MfaForm` に recovery code モード切替リンク・入力欄は実装しない。
  - `MfaVerifyRequest` 型は将来拡張に備えて `{ code: string }` のみのオブジェクト型として定義し、`recovery_code` ブランチは作らない。必要になった時点で判別共用体に拡張する。
  - エラーコード `INVALID_RECOVERY_CODE` は AuthCore 仕様には存在するが、拡張側では本タスクでは取り扱わない（汎用エラーメッセージにフォールバック）。
- **MFA 設定 UI**（register/enable/disable）: 別タスク。
- **WebAuthn / Passkey**: AuthCore 側未実装のため対象外。

## 要件の前提（仮定）

確定事項以外の細部について、以下を前提とする。レビュー時に修正したい点があれば指示してほしい。

1. **UI フロー**: 同じ popup 内で `LoginForm` → `MfaForm`（新規）にステートフル切替。ページ遷移は使わず、`AuthProvider` が保持する MFA challenge state で出し分ける。
2. **pre_token の memory only 採用理由**:
   - pre_token は 10 分の短命トークンで永続化価値が薄い。
   - service worker の suspension で消えるが、消えた場合は再ログイン要求にフォールバックさせれば安全。
   - ストレージに残すと「MFA 中断中」状態が長期間残ってしまい UX を損なう。
   - `chrome.storage.session` も使わない（ブラウザ再起動で消える点は同じで、複雑さに見合わない）。
3. **pre_token 期限切れ／service worker 再起動時**: 明示的なエラーを popup に通知し、`LoginForm` へ戻す（identifier/password の再入力を要求）。`PRE_TOKEN_EXPIRED` / `PRE_TOKEN_INVALID` / `MFA_NOT_PENDING` 受信時はすべて同じ扱い。
4. **キャンセル動作**: MFA 入力画面に「戻る／キャンセル」ボタンを置き、background の pre_token を破棄して `LoginForm` に戻る。
5. **MFA verify 成功後**: 既存の通常ログイン成功時と同じく `TokenResponse` を永続化、`getProfile` で User を取得、`scheduleRefresh` を実行する。
6. **UI 文言**: 既存と揃える形で日本語、入力欄は TOTP の 6 桁数字を想定。

## 影響範囲

### 既存ファイルの変更

- `src/shared/auth/types.ts` — `MfaVerifyRequest` 型追加（`{ code: string }`、TOTP のみ）。`MfaChallenge` 型追加。
- `src/shared/auth/errors.ts` — `INVALID_TOTP`, `PRE_TOKEN_INVALID`, `PRE_TOKEN_EXPIRED`, `MFA_REQUIRED`, `MFA_NOT_PENDING` などのコード定数を整理。**`MFA_NOT_SUPPORTED` は deprecated 注記つきで残置**。
- `src/shared/auth/client.ts` — `verifyMfa(preToken, body)` を新設
- `src/shared/auth/messages.ts` — `AUTH_MFA_VERIFY` メッセージ型と `AUTH_MFA_CANCEL` メッセージ型を追加。`LoginResponseData` に `{ user } | { mfaRequired: true; expiresIn: number }` の判別共用体を導入
- `src/background/auth-manager.ts` — `handleLogin()` の MFA 分岐を「pre_token を保持して `mfaRequired` を返す」に変更。`handleMfaVerify(req)` / `handleMfaCancel()` を追加。in-memory pre_token state の管理（タイマーで自動破棄）
- `src/background/message-handler.ts` — 新メッセージのディスパッチを追加
- `src/popup/auth/auth-context.ts` — `mfaChallenge` state, `verifyMfa`, `cancelMfa` を context に追加
- `src/popup/auth/AuthProvider.tsx` — login 結果の `mfaRequired` を受け取り、challenge state を更新。`verifyMfa` / `cancelMfa` を実装
- `src/popup/auth/useAuth.ts` — context value の型変更を追従
- `src/popup/App.tsx` — `AuthGate` に MFA 入力画面の分岐を追加（`mfaChallenge ? <MfaForm /> : <LoginForm />`）
- `src/popup/auth/LoginForm.tsx` — `MFA_NOT_SUPPORTED` のエラーメッセージ削除（通常フローでは到達しなくなるため）
- `src/popup/App.css` — MFA フォーム用のスタイル追加（既存スタイルを流用予定なら最小）

### 新規ファイル

- `src/popup/auth/MfaForm.tsx` — TOTP 入力フォーム（recovery code モードは実装しない）
- （任意）`src/shared/auth/mfa.ts` — `validateTotpCode` などのバリデーションヘルパ。LoginForm/MfaForm を薄く保ちたければ作成

### 破壊的変更

- popup → background のメッセージプロトコルに新メッセージ型が増える。**`AUTH_LOGIN` のレスポンス形が `{ user }` から `{ user } | { mfaRequired: true; ... }` に変わる**ため、popup 側のディスパッチ処理を必ず更新する必要あり（型で強制）。
- `MFA_NOT_SUPPORTED` を期待していた既存の UI 文言は LoginForm から削除される（コード定数自体は残置）。

## `MFA_NOT_SUPPORTED` の取り扱い（deprecated 残置）

### 残置する理由

- 過去ログ / バグレポート / 既存テストで `MFA_NOT_SUPPORTED` 文字列が参照されている可能性があり、定数を削除すると追跡できなくなる。
- 将来 MFA 全体を一時的にロールバック（feature flag で無効化など）する選択肢を残しておきたい。
- 現状の本フロー（TOTP の正常系）以外の MFA 未対応サブケース（recovery code 等）でフォールバックエラーとして再利用できる。

### 実装上の扱い

- `src/shared/auth/errors.ts` の `AuthErrorCode` から `MFA_NOT_SUPPORTED` は削除しない。
- 定数定義の直前に JSDoc コメントで以下を明記する。

  ```ts
  /**
   * @deprecated 本タスク（support-mfa-login）以降、TOTP MFA は通常フローで対応済み。
   *   このコードは下記用途のために残置している:
   *     - recovery code 等、本拡張ではまだ未対応の MFA サブケースのフォールバック
   *     - 将来 MFA 全体を一時的に無効化（feature flag 等）したい場合の再利用
   *   通常の TOTP MFA フローでは throw しない。
   */
  MFA_NOT_SUPPORTED: 'MFA_NOT_SUPPORTED',
  ```

### 投げるケース（本タスク時点）

- `src/background/auth-manager.ts` の `handleLogin()` で `PreTokenResponse` を受けた場合は **throw しない**（pre_token を保持して `mfa_required` を返す）。
- 一方、AuthCore がもし `mfa_required` だが TOTP 以外のメソッドだけが有効になっているユーザー（例: recovery code only / WebAuthn only など）を返す可能性がある場合、拡張側でメソッド種別を判定できないため、本タスクではそこまでガードしない（AuthCore 側の `available_methods` フィールドが未活用のため）。将来 recovery code に対応するまでの間に、`PreTokenResponse` のメソッド情報から「TOTP 不可」と判定できる場面が出てきた場合、ここで `MFA_NOT_SUPPORTED` を throw する形で再利用する想定。
- 既存テスト・ログ等で `MFA_NOT_SUPPORTED` 文字列を参照している箇所があれば、本タスクでは触らずに残す。

## 実装ステップ

### Phase 1: 型・エラーコード・API クライアントの拡張

1. `src/shared/auth/types.ts` に MFA verify 用の型を追加。
   ```ts
   // recovery code 対応は対象外。将来拡張する際に判別共用体化する。
   export interface MfaVerifyRequest {
     code: string;
   }

   export interface MfaChallenge {
     // popup 側に渡す MFA 入力フェーズの情報。pre_token そのものは渡さない。
     expiresAt: number; // Unix seconds, pre_token の `exp`
   }
   ```
2. `src/shared/auth/errors.ts` に MFA 関連エラーコードを整理。
   - 追加: `INVALID_TOTP`, `PRE_TOKEN_INVALID`, `PRE_TOKEN_EXPIRED`, `MFA_NOT_PENDING`（pre_token 不在状態で verify が呼ばれた拡張側エラー）。
   - **残置**: `MFA_NOT_SUPPORTED`（上記「`MFA_NOT_SUPPORTED` の取り扱い」セクション参照、`@deprecated` コメントを追加）。
   - 追加しない: `INVALID_RECOVERY_CODE`（recovery code 非対応のため）。
3. `src/shared/auth/client.ts` に `verifyMfa(preToken, body)` を追加。
   - `POST /v1/auth/mfa/verify`、`Authorization: Bearer <preToken>`、body は `MfaVerifyRequest`、レスポンスは `TokenResponse`。
   - `request()` ヘルパに `bearerToken` オプションを追加してもよい（`getProfile` と統一）。

### Phase 2: メッセージプロトコルの拡張

4. `src/shared/auth/messages.ts` を拡張。
   ```ts
   export const AuthMessageType = {
     LOGIN: 'AUTH_LOGIN',
     MFA_VERIFY: 'AUTH_MFA_VERIFY',
     MFA_CANCEL: 'AUTH_MFA_CANCEL',
     LOGOUT: 'AUTH_LOGOUT',
     GET_STATE: 'AUTH_GET_STATE',
     REFRESH: 'AUTH_REFRESH',
     FETCH: 'AUTH_FETCH',
   } as const;

   // AUTH_LOGIN のレスポンスは判別共用体に
   export type LoginResponseData =
     | { kind: 'success'; user: User }
     | { kind: 'mfa_required'; challenge: MfaChallenge };

   export type MfaVerifyResponseData = { user: User };
   ```
   - `AUTH_MFA_VERIFY` の payload は `MfaVerifyRequest`。
   - `AUTH_MFA_CANCEL` の payload はなし。
5. `isAuthMessage` を新メッセージ型に対応させる。

### Phase 3: background の auth-manager 改修

6. `src/background/auth-manager.ts` に in-memory state を導入。**永続化はしない（`chrome.storage` 系は触らない）。**
   ```ts
   interface PendingMfaState {
     preToken: string;
     expiresAt: number; // Unix seconds
     timeoutId: ReturnType<typeof setTimeout> | null;
   }
   let pendingMfa: PendingMfaState | null = null;
   ```
   - `setPendingMfa(preToken)`: `decodeJwt(preToken).exp` から expiresAt を算出し保存。`setTimeout` で `(exp - now) * 1000` ms 後に自動クリア。
   - `clearPendingMfa()`: タイマー破棄 + state null 化。
7. `handleLogin()` を改修。
   ```ts
   export async function handleLogin(request: LoginRequest):
     Promise<{ kind: 'success'; user: User } | { kind: 'mfa_required'; challenge: MfaChallenge }> {
     const response = await loginRequest(request);
     if (isPreTokenResponse(response)) {
       // 本タスクでは MFA_NOT_SUPPORTED は throw しない。
       setPendingMfa(response.pre_token);
       return { kind: 'mfa_required', challenge: { expiresAt: pendingMfa!.expiresAt } };
     }
     await persistTokenResponse(response);
     const user = await getProfile(response.access_token);
     await setUser(user);
     return { kind: 'success', user };
   }
   ```
8. `handleMfaVerify(req: MfaVerifyRequest)` を追加。
   - `pendingMfa` が null の場合: `MFA_NOT_PENDING` を throw。
   - `expiresAt <= now` の場合: `PRE_TOKEN_EXPIRED` を throw（pendingMfa はクリア）。
   - `verifyMfa(pendingMfa.preToken, req)` を呼び、成功したら通常ログイン後処理（`persistTokenResponse` + `getProfile` + `setUser`）。最後に `clearPendingMfa()`。
   - サーバーから `INVALID_TOTP` が返ったときは pendingMfa を保持したまま再試行可能とする。`PRE_TOKEN_INVALID` / `PRE_TOKEN_EXPIRED` を受け取ったら `clearPendingMfa()` してから throw。
9. `handleMfaCancel()` を追加。`clearPendingMfa()` のみ。
10. `init()` 内では `pendingMfa` には触れない（service worker 再起動跨ぎでは破棄される設計のため）。

### Phase 4: message-handler の dispatch 追加

11. `src/background/message-handler.ts` の `dispatch()` switch に 2 ケースを追加。
    ```ts
    case AuthMessageType.MFA_VERIFY: {
      const data = await authManager.handleMfaVerify(message.payload);
      return { ok: true, data };
    }
    case AuthMessageType.MFA_CANCEL: {
      await authManager.handleMfaCancel();
      return { ok: true, data: undefined };
    }
    ```
12. exhaustive switch を維持するため `AuthMessage` 型側との同期を確認。

### Phase 5: popup 側のコンテキスト・UI

13. `src/popup/auth/auth-context.ts` の `AuthContextValue` を拡張。
    ```ts
    export interface AuthContextValue {
      user: User | null;
      isAuthenticated: boolean;
      loading: boolean;
      error: AuthErrorPayload | null;
      mfaChallenge: MfaChallenge | null;
      login: (request: LoginRequest) => Promise<void>;
      verifyMfa: (request: MfaVerifyRequest) => Promise<void>;
      cancelMfa: () => Promise<void>;
      logout: () => Promise<void>;
      clearError: () => void;
    }
    ```
14. `src/popup/auth/AuthProvider.tsx` を改修。
    - `mfaChallenge` state を追加（初期値 null）。
    - `login()` 内でレスポンスが `kind === 'mfa_required'` のときは `setMfaChallenge(challenge)`（user/isAuthenticated は更新しない）。`kind === 'success'` のときは従来通り。
    - `verifyMfa(req)`: `AUTH_MFA_VERIFY` を送信。成功時は `setMfaChallenge(null)` + `setUser(data.user)` + `setIsAuthenticated(true)`。失敗時は `error` を設定し、`PRE_TOKEN_EXPIRED` / `PRE_TOKEN_INVALID` / `MFA_NOT_PENDING` のときは `setMfaChallenge(null)` で LoginForm に戻す。
    - `cancelMfa()`: `AUTH_MFA_CANCEL` 送信 + `setMfaChallenge(null)` + `setError(null)`。
    - 永続化された state には MFA challenge を保存しないため、popup を閉じて開き直すと自動で MFA 画面はリセットされる（pre_token も background でタイマー消去されるので整合）。
15. `src/popup/auth/MfaForm.tsx` を新規作成。**TOTP 入力のみを扱う。recovery code モードは実装しない。**
    - props なし、`useAuth()` から `verifyMfa`, `cancelMfa`, `loading`, `error`, `clearError`, `mfaChallenge` を取得。
    - state: `code` 文字列（6 桁数字）。
    - フォーム送信時、`{ code }` をサーバーに送る。
    - バリデーション: `^[0-9]{6}$`。
    - 「キャンセル」ボタンで `cancelMfa()` を呼ぶ（必須・本タスクで実装する）。
    - エラー表示用の `formatMfaError(error)` を新設し、以下をハンドリング:
      - `INVALID_TOTP` → 「コードが正しくありません」
      - `PRE_TOKEN_EXPIRED` → 「セッションが期限切れになりました。最初からやり直してください」
      - `PRE_TOKEN_INVALID` → 「セッションが無効です。最初からやり直してください」
      - `MFA_NOT_PENDING` → 「セッションが見つかりません。最初からやり直してください」
      - `RATE_LIMIT_EXCEEDED` → 既存と同じ
      - その他 → `error.message`
    - challenge expiry を視覚化したい場合は残り秒数のカウントダウンを表示（任意、2 段階リリース可）。
16. `src/popup/auth/LoginForm.tsx` の `formatError()` から `MFA_NOT_SUPPORTED` のケースを削除（通常の TOTP MFA フローでは到達しないため）。定数自体は残置されているので import は維持してよい。
17. `src/popup/App.tsx` の `AuthGate` を更新。
    ```tsx
    const { isAuthenticated, loading, user, mfaChallenge } = useAuth();
    if (loading && !user && !isAuthenticated && !mfaChallenge) return <Loading />;
    if (mfaChallenge) return <MfaForm />;
    return isAuthenticated ? <Dashboard /> : <LoginForm />;
    ```
18. `src/popup/App.css` に `.mfa-form` 関連スタイルを追加（既存 `.auth-form`/`.auth-field`/`.auth-submit` を流用する場合は最小）。

### Phase 6: 動作検証

19. AuthCore ローカル起動 → テストユーザーで MFA を有効化（`/v1/auth/mfa/register` → `enable`）。
    - recovery_codes は本タスクでは検証で使わない（TOTP のみ）。
20. 拡張機能をビルドし `chrome://extensions` でリロード。
21. 検証ケース:
    - **正常系 TOTP**: ログイン → MFA 入力 → TOTP 6 桁 → 成功で Dashboard へ。
    - **不正な TOTP**: `INVALID_TOTP` エラー表示、画面は MFA 入力に留まる。
    - **キャンセル**: MFA 画面で「キャンセル」 → LoginForm に戻り再ログイン可能。
    - **pre_token 期限切れ**: 11 分以上待機 → MFA 入力 → エラー → LoginForm に戻る。
    - **service worker 再起動**: chrome.devtools で background を強制停止 → MFA 画面で送信 → `MFA_NOT_PENDING` エラー → LoginForm に戻る。
    - **MFA 未設定ユーザー**: 既存のログインフローに影響なし。
    - **ブラウザ再起動跨ぎ**: ログイン完了後（refresh 完了後）の再起動でログイン状態維持。
    - **recovery code は検証対象外**: 本タスクでは UI も API 呼び出しもないため、ユーザーが TOTP デバイスを失った場合のリカバリーは AuthCore 側別経路を使う運用とする。

## テスト要件

- **単体（手動 or vitest 導入時）**:
  - `verifyMfa()` クライアントが正しい URL/ヘッダ/ボディを送る（body は `{ code }` のみ）。
  - `auth-manager.handleLogin()` が pre_token 受領時に `mfa_required` を返し、in-memory に保持。
  - `auth-manager.handleMfaVerify()` の成功・失敗（`INVALID_TOTP`）・期限切れ・pendingMfa 不在（`MFA_NOT_PENDING`）の各分岐。
  - `pendingMfa` の自動破棄タイマーが `exp` 時刻で動く。
  - `MFA_NOT_SUPPORTED` 定数が `errors.ts` に存在し続けることを確認するスナップショット／import テスト（任意）。
- **手動 E2E**: Phase 6 の 21 番。

## 技術的な補足

### pre_token の保管戦略（memory only 確定）

- AuthCore の pre_token は `type: pre`、TTL 10 分、ボディ配送（cookie 不使用）。Refresh Token Rotation には乗らない単発トークン。
- 拡張機能の background は MV3 service worker のため、idle で suspend → memory 消失。**pendingMfa は memory only**（`chrome.storage.session` も含めて使わない）とし、消失時はユーザーに再ログインを要求する設計とする。
- `chrome.storage.session` を使わない理由: ブラウザ再起動で消える点は同じで、永続化価値が薄く、複雑さに見合わないため。
- service worker は `chrome.runtime.sendMessage` を受信した瞬間に再起動するため、popup が MFA 画面を表示している間に background が一度寝ても、ユーザーが verify を送信した時点で起動済みの新しい worker が pendingMfa を見ることになる。**しかし pendingMfa はそこで null になっている**ため、`MFA_NOT_PENDING` エラーで LoginForm に戻すフォールバックを必ず実装する。
- 上記制約を回避するために pre_token を popup から background に毎回送ってもらう設計（popup が pre_token を保持）も理論上可能だが、popup を閉じる/開き直すと消える上、popup プロセスに pre_token が露出するリスクがあるため不採用。

### 既知の制約

- AuthCore の MFA verify は **TOTP の時刻ずれ許容窓**を持つはずだが、拡張機能側では時刻同期は不要（サーバー任せ）。
- `INVALID_TOTP` を一定回数連続で受けた場合のレート制限は AuthCore 側のみで実装されているため、拡張機能側で独自カウントは不要。`RATE_LIMIT_EXCEEDED` を素直に表示する。
- recovery code を本タスクでは扱わないため、TOTP デバイス紛失時のリカバリーは AuthCore のサポート経路（管理者操作 or 別 UI）に委ねる。

### 将来の拡張

- **recovery code 対応**: `MfaVerifyRequest` を `{ code: string } | { recovery_code: string }` に拡張し、`MfaForm` にモード切替リンクを追加する別タスクで実施する。`INVALID_RECOVERY_CODE` エラーコードもその時点で追加。
- MFA 設定 UI（`/v1/auth/mfa/register`/`enable`/`disable`）は別タスク。
- WebAuthn / Passkey 対応は AuthCore 側で未実装のため対象外。
- `MFA_NOT_SUPPORTED` を活用: 将来 AuthCore の `PreTokenResponse` で利用可能 MFA メソッドが提示されるようになり、TOTP が含まれていないケースを検出できるようになった場合、`auth-manager.handleLogin()` でこのエラーを再度 throw する形で活用する。

### 関連ドキュメント

- `../auth/docs/api-summary.md`（§3.2 MFA）
- `../auth/docs/openapi.yaml`（`/v1/auth/mfa/verify` 詳細スキーマ）
- `../auth/docs/flows/password-login.md`（pre_token フロー全体）
- `../auth/docs/flows/auth-methods.md`（`type=pre` クレームと許可エンドポイント）
- 直前タスク: `docs/tasks/implement-login-with-persistence.md`
