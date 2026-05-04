# YouTube チャンネル連携機能の追加（link フロー + 連携済み一覧表示）

## 概要

ログイン済み Fuju ユーザーが、自分が所有する YouTube チャンネルを Fuju アカウントに紐づけられるようにする。さらに Dashboard 上で連携済み YouTube チャンネルの一覧（チャンネル名）を表示する。

実装方針は AuthCore 側の対応により以下のとおりに整理された:

- **link フロー**: 既存 X / Google と完全に同じ `GET /v1/auth/connect/youtube` + fragment callback 構成。拡張機能側は `Provider` 型に `'youtube'` を追加し Dashboard にボタンを 1 つ増やすだけで動作する。所有検証は AuthCore 側が `youtube/v3/channels?mine=true` を直接叩いて行うため、拡張機能から Google OAuth トークン取得や YouTube Data API の直接呼び出しは **行わない**。
- **連携済みチャンネル一覧表示**: AuthCore が新設する `GET /v1/user/social-accounts` エンドポイントから連携済み social account の一覧（`display_name` を含む）を取得し、Dashboard で YouTube provider 分のみフィルタして表示する。

最終ゴールのうち本タスクのスコープは **(a) link フローの追加 + Dashboard でのボタン提供**、および **(c) Dashboard での連携済み YouTube チャンネル一覧（チャンネル名）表示** までとする。**(b) X 上 / YouTube 上での「認証済みアイコン」表示** および **unlink 動線** は別タスク。

## 背景・目的

- AuthCore 側は YouTube プロバイダ受け入れの API（`GET /v1/auth/connect/youtube` + fragment callback）が整備済み。X / Google link と完全に同じ動線で、`provider_user_id` には **YouTube channel ID（`UC...`）** が乗る。
- 拡張機能側からの動線がまだ無く、ユーザーが「チャンネル所有」を Fuju に証明する手段が無い。
- 連携済みチャンネル一覧の取得手段が存在しなかったが、AuthCore 側で `GET /v1/user/social-accounts` を新設し、合わせて DB migration で `display_name` 列（チャンネル名）を追加することが確定したため、Dashboard 表示も本タスクのスコープに含める。
- 当初想定していた「拡張機能側で `chrome.identity.getAuthToken` 経由で Google OAuth トークン取得 → `youtube.channels.list` で一覧取得 → AuthCore に登録 POST」という構成は、AuthCore 側が所有検証を引き取る設計のため不要。拡張機能側の責務は X / Google と同じ「link authorize URL を取得して `launchWebAuthFlow` に投げ、callback fragment を検証する」+「`/v1/user/social-accounts` を叩いて結果を表示する」の組み合わせになる。

## 影響範囲

既存 link フローを provider 名だけ拡張する変更 + 新規メッセージと API クライアントの追加。**破壊的変更は無い**。

### 既存実装の確認結果（既存コードが完全に provider 汎用な作りになっているか）

調査の結果、**既存の X / Google link フローは provider 名だけで分岐できる作り** であることを確認した:

- `src/shared/auth/providers.ts` の `getConnectAuthorizeUrl(accessToken, provider, finalRedirect)` は provider 名を URL `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}` に文字列補間しているだけで、provider 別のハードコード分岐は無い。
- `src/background/provider-manager.ts` の `handleGetConnectUrl(provider)` も provider をそのまま `getConnectAuthorizeUrl` に渡すだけ。
- `src/popup/auth/Dashboard.tsx` の `handleConnect(provider)` は provider を引数で受け、`launchWebAuthFlow` → `assertLinkSucceeded`（fragment の `linked=1` を検証）まで provider 不問で動く。
- `providerLabel` には `default` 節があり、`'youtube'` を追加しなくても文字列としては動くが、明示的に case を増やすべき場所はここだけ。

→ link フロー自体は `Provider` 型 union に `'youtube'` を加え、Dashboard にボタンを 1 つ追加するだけで動作する。

### 連携済み一覧取得の追加実装パターン

新規 API は既存パターンに合わせて以下の階層で実装する:

- **API クライアント層**: `src/shared/auth/client.ts` に `getSocialAccounts(accessToken)` を追加。既存の `getProfile` と同じく `request<T>` を使う。
- **メッセージ層**: `src/shared/auth/messages.ts` に `PROVIDER_GET_SOCIAL_ACCOUNTS: 'PROVIDER_GET_SOCIAL_ACCOUNTS'` を追加（`PROVIDER_GET_CONNECT_URL` と同じ命名規則）。レスポンス型 `ProviderGetSocialAccountsResponseData` を定義。
- **background 層**: `src/background/provider-manager.ts` に `handleGetSocialAccounts()` を追加し、`ensureAccessToken` 経由で AuthCore client を呼ぶ。`src/background/message-handler.ts` に dispatch case を追加。
- **popup 層**: `Dashboard.tsx` で `useEffect` で初期取得し、YouTube provider のみをフィルタしてリスト表示。

### 変更ファイル一覧

#### 既存ファイルの変更

- `src/shared/auth/providers.ts`
  - `export type Provider = 'x' | 'google';` を `'x' | 'google' | 'youtube';` に拡張。
  - JSDoc に `'youtube'` の説明（「YouTube。所有チャンネル単位で連携。1 link 操作 = 1 channel」）を追記。
  - `getConnectAuthorizeUrl` 自体の実装変更は不要。

- `src/shared/auth/errors.ts`
  - `AuthErrorCode` に以下を追加（AuthCore が link 失敗時に返すコード）:
    - `SOCIAL_ALREADY_LINKED`: 「同じユーザーが同じチャンネルを既に連携している」
    - `SOCIAL_ALREADY_LINKED_TO_OTHER_USER`: 「他ユーザーが同じチャンネルを連携している」
  - 既存の `RATE_LIMIT_EXCEEDED` は流用。

- `src/shared/auth/client.ts`
  - `getSocialAccounts(accessToken)` を追加（`request<SocialAccountsResponse>('/v1/user/social-accounts', { method: 'GET', bearerToken: accessToken })`）。
  - 想定レスポンス型を本ファイルまたは `types.ts` に定義（後述「想定レスポンス形」）。

- `src/shared/auth/types.ts`
  - `SocialAccount` 型と `SocialAccountsResponse` 型を追加（想定レスポンス形に合わせる）。

- `src/shared/auth/messages.ts`
  - `AuthMessageType.PROVIDER_GET_SOCIAL_ACCOUNTS = 'PROVIDER_GET_SOCIAL_ACCOUNTS'` を追加。
  - `AuthMessage` union に `{ type: typeof AuthMessageType.PROVIDER_GET_SOCIAL_ACCOUNTS }` を追加（payload 不要）。
  - `ProviderGetSocialAccountsResponseData` 型を追加。

- `src/background/provider-manager.ts`
  - `handleGetSocialAccounts()` を追加。`ensureAccessToken()` → `client.getSocialAccounts()` を呼んで結果を返す。

- `src/background/message-handler.ts`
  - `dispatch` の switch に `case AuthMessageType.PROVIDER_GET_SOCIAL_ACCOUNTS` を追加し、`providerManager.handleGetSocialAccounts()` を呼び出す。

- `src/popup/auth/Dashboard.tsx`
  - 「YouTube と連携」ボタンを「Google と連携」の隣に追加。click ハンドラは既存の `handleConnect('youtube')` を呼ぶだけ。
  - `providerLabel` の switch に `case 'youtube': return 'YouTube';` を追加。
  - `formatLinkError` に link 起因のエラーコード分岐を追加:
    - `SOCIAL_ALREADY_LINKED` → 「このチャンネルは既に連携済みです。」
    - `SOCIAL_ALREADY_LINKED_TO_OTHER_USER` → 「このチャンネルは別の Fuju アカウントに連携されています。」
  - 連携済み YouTube チャンネル一覧 UI（`display_name` をリスト表示）を追加:
    - `useEffect` で `PROVIDER_GET_SOCIAL_ACCOUNTS` を送信し、結果を state に保持。
    - link 成功時にも再取得してリストを更新。
    - `ローディング中` / `エラー` / `空（未連携）` 状態のハンドリング。
    - YouTube provider 分のみ filter して表示（X / Google 分は本タスクでは表示しない予定だが、将来拡張余地は残す）。

- `public/manifest.json`
  - **変更不要**。`launchWebAuthFlow` を使うため `chrome.identity.getAuthToken` は呼ばず、`oauth2` セクションの追加も `host_permissions` の追加も不要。`identity` permission は既に X / Google link 用に登録済み。

#### 新規ファイル

- なし。

### 想定レスポンス形（AuthCore `GET /v1/user/social-accounts`）

具体的なレスポンス形は AuthCore 実装側に合わせる。本ドキュメント時点での想定形は以下:

```ts
interface SocialAccount {
  provider: 'x' | 'google' | 'youtube';
  provider_user_id: string;   // YouTube の場合は channel ID (`UC...`)
  display_name: string;       // YouTube の場合は channel title (snippet.title)
  // 必要に応じて linked_at: string などの追加フィールド
}

interface SocialAccountsResponse {
  accounts: SocialAccount[];
}
```

AuthCore 側の確定スキーマを受け取り次第、型と client 実装をそれに合わせて更新する。

### 破壊的変更

- **なし**。`Provider` 型 union 拡張は呼び出し側の網羅 switch（`Dashboard.tsx` の `providerLabel` のみ）を 1 箇所更新するだけで対応可能。`AuthMessageType` への追加も既存利用箇所に影響しない。

## 実装ステップ

### Phase 1: Provider 型と error コードの拡張

1. `src/shared/auth/providers.ts` の `Provider` 型に `'youtube'` を追加し、JSDoc を更新する。
2. `src/shared/auth/errors.ts` の `AuthErrorCode` に `SOCIAL_ALREADY_LINKED` と `SOCIAL_ALREADY_LINKED_TO_OTHER_USER` を追加する（値は同名文字列）。

### Phase 2: link フローの Dashboard UI 動線追加

3. `src/popup/auth/Dashboard.tsx`:
   - `providerLabel` の switch に `case 'youtube': return 'YouTube';` を追加。
   - `formatLinkError` の switch に以下を追加:
     ```ts
     case AuthErrorCode.SOCIAL_ALREADY_LINKED:
       return 'このチャンネルは既に連携済みです。';
     case AuthErrorCode.SOCIAL_ALREADY_LINKED_TO_OTHER_USER:
       return 'このチャンネルは別の Fuju アカウントに連携されています。';
     ```
   - 「Google と連携」ボタンの直後に「YouTube と連携」ボタンを追加:
     ```tsx
     <button
       type="button"
       className="auth-secondary"
       onClick={() => { void handleConnect('youtube'); }}
       disabled={isBusy}
     >
       {linkingProvider === 'youtube' ? '連携中…' : 'YouTube と連携'}
     </button>
     ```
   - 既存の `handleConnect` / `assertLinkSucceeded` / `launchWebAuthFlow` には変更不要。`assertLinkSucceeded` は fragment から `linked=1` と `provider` / `provider_user_id` の存在を検証するだけで、`provider_user_id` の値が channel ID (`UC...`) でも従来通り通過する。

### Phase 3: 連携済みチャンネル一覧 API の配線

4. `src/shared/auth/types.ts` に `SocialAccount` / `SocialAccountsResponse` 型を追加（想定レスポンス形を採用、AuthCore 側の確定スキーマで上書き）。
5. `src/shared/auth/client.ts` に `getSocialAccounts(accessToken)` を追加（`request<SocialAccountsResponse>('/v1/user/social-accounts', { bearerToken: accessToken })`）。
6. `src/shared/auth/messages.ts` に `PROVIDER_GET_SOCIAL_ACCOUNTS` メッセージタイプ、`AuthMessage` union への追加、`ProviderGetSocialAccountsResponseData` 型を追加。
7. `src/background/provider-manager.ts` に `handleGetSocialAccounts()` を追加（`ensureAccessToken` → `client.getSocialAccounts`）。
8. `src/background/message-handler.ts` の dispatch に case を追加し、`providerManager.handleGetSocialAccounts()` を呼び出す。

### Phase 4: 連携済み YouTube チャンネル一覧 UI

9. `src/popup/auth/Dashboard.tsx`:
   - state を追加: `socialAccounts: SocialAccount[] | null`、`socialAccountsLoading: boolean`、`socialAccountsError: string | null`。
   - 初回マウント時に `PROVIDER_GET_SOCIAL_ACCOUNTS` を送信して取得（`useEffect`）。
   - `handleConnect` の成功時にも再取得してリスト更新。
   - YouTube provider のみフィルタしたリストを表示（`display_name` を主表示、`provider_user_id` は二次情報として）。
   - 状態別表示:
     - ローディング中: 「読み込み中…」
     - エラー: `formatLinkError` を流用したメッセージ表示
     - 空: 「連携済みの YouTube チャンネルはありません。」
     - 1 件以上: `<ul>` で `display_name` をリスト表示
   - **AuthCore 側の `GET /v1/user/social-accounts` がリリースされるまでは、開発時にモックデータで動作確認する**（後述の「テスト要件」を参照）。

### Phase 5: 動作確認

10. `npm run build` で `tsc -b` を通す（`Provider` 型 union 拡張・`AuthMessageType` 追加時の網羅性が壊れていないこと）。
11. `npm run lint`。
12. 後述の手動 E2E シナリオを通す。

## 依存関係

本タスクは AuthCore 側の以下の対応に依存する:

1. **`GET /v1/user/social-accounts` エンドポイントの実装**
2. **`social_accounts` テーブルへの `display_name` 列追加 migration + link 時の `youtube/v3/channels?mine=true` の `snippet.title` を保存する経路**

並行作業は可能（拡張機能側でモックデータを使って Dashboard 表示部分を実装・確認できる）だが、**Dashboard 表示部分の実機 E2E テストには AuthCore 側のリリースが必要**。link フロー単体（Phase 1 + Phase 2）は AuthCore 側の既存 API のみで成立するため、AuthCore 側のリリースを待たずに先行リリース可能。

## テスト要件

本リポジトリには現状ユニットテストフレームワーク（vitest / jest 等）が導入されていないため、**手動 E2E + 型チェックを主軸にする**。新規ユニットテストは導入しない。型整合性は `npm run build`（`tsc -b`）で網羅確認する。

### Dashboard 表示部分のモック対応

**AuthCore 側の `GET /v1/user/social-accounts` 実装と `display_name` migration がリリースされるまで、Dashboard の連携済みチャンネル一覧表示部分は実 API では検証できない**。それまでの開発時は以下のいずれかで動作確認する:

- (A) **background の `handleGetSocialAccounts` を一時的にモック化**: `client.getSocialAccounts` を呼ぶ代わりにハードコードされた `SocialAccount[]` を返す実装に切り替えて popup の表示を確認する。検証後はモックを除去してから commit する（あるいは `if (DEV_MOCK_SOCIAL_ACCOUNTS)` のような明示的な分岐にして PR レビューで除去判断する）。
- (B) **MSW などを使わず、`Dashboard.tsx` 内で fetch 結果を一時的にハードコードして表示確認**: コンポーネント実装の妥当性のみ確認できる。AuthCore 側リリース後に実 API への接続確認を必ず実施する。

AuthCore 側のリリース完了後、**実 API での E2E（後述シナリオ 9〜11）を必ず通してから本タスクをクローズする**。

### 手動検証シナリオ

#### link フロー

1. **正常系（単一チャンネル）**: ログイン済みユーザーが「YouTube と連携」 → Google 同意画面 → `launchWebAuthFlow` が `#linked=1&provider=youtube&provider_user_id=UC...` を返す → 「YouTube と連携しました。」が表示される。
2. **正常系（複数チャンネル登録）**: 同一ユーザーが「YouTube と連携」を再度押し、別の Google アカウント / 別チャンネルで連携 → 別の channel ID で 200 が返り成功表示。**1 OAuth フロー = 1 channel** の前提が成立していることを確認する。
3. **既登録（自分）**: 一度連携済みのチャンネルで再度「YouTube と連携」 → AuthCore が `SOCIAL_ALREADY_LINKED` を返す → 「このチャンネルは既に連携済みです。」表示。
4. **既登録（他ユーザー）**: 別の Fuju アカウントで一度連携した channel を、別ログインで連携しようとする → `SOCIAL_ALREADY_LINKED_TO_OTHER_USER` → 「このチャンネルは別の Fuju アカウントに連携されています。」表示。
5. **OAuth キャンセル**: Google 同意画面で「キャンセル」 → `launchWebAuthFlow` が reject → 既存の error フォールバック文言が表示される（X / Google と同じ挙動）。
6. **チャンネル 0 件**: YouTube チャンネルを作っていない Google アカウントで連携を試みた場合の AuthCore 側の挙動 → AuthCore が返すエラーコードに応じて文言を確認（実装側でハンドリング不足があれば追加）。
7. **レート制限**: `RATE_LIMIT_EXCEEDED` を返す状況で「リクエストが多すぎます。…」が表示されること。
8. **既存フローの非破壊性**: identifier+password ログイン、TOTP MFA、X 連携、Google 連携、ログアウト、自動 refresh が従来通り動作すること。X.com 上のアイコン挿入が壊れていないこと。

#### 連携済み一覧表示（要 AuthCore 側リリース）

9. **空状態**: 連携済み YouTube チャンネルが 0 件のユーザーで Dashboard を開く → 「連携済みの YouTube チャンネルはありません。」が表示される。
10. **1 件以上**: 連携済み YouTube チャンネルがあるユーザーで Dashboard を開く → `display_name`（チャンネル名）がリスト表示される。
11. **link 後の即時反映**: 「YouTube と連携」成功直後にリストが再取得され、新しく連携した channel の `display_name` が表示に追加される。

#### 型 / lint

- `npm run build` が通ること（`tsc -b` で `Provider` 型および `AuthMessageType` の switch 網羅性が壊れていないこと、`AuthErrorCode` 追加で型不整合が出ないこと）。
- `npm run lint` が通ること。

## 技術的な補足

### AuthCore link フローの再利用

- `GET /v1/auth/connect/youtube?final_redirect=<extension-redirect>` を `Accept: application/json` で叩くと AuthCore は `{ authorize_url, state }` を返す（既存 X / Google と完全に同じ body-mode 仕様）。
- `launchWebAuthFlow` で authorize URL に投げ、Google 側の同意完了後 AuthCore に戻り、最終的に `https://<extension-id>.chromiumapp.org/cb#linked=1&provider=youtube&provider_user_id=UC...` 形式の fragment 付き URL に redirect される。
- 拡張機能側はこの fragment の `linked=1` と `provider` / `provider_user_id` の存在を検証するだけ（既存 `assertLinkSucceeded` を流用）。

### 所有検証は AuthCore 側で完結

- AuthCore が `https://www.googleapis.com/youtube/v3/channels?mine=true` を直接叩いて Google アカウントが所有するチャンネルを取得し、そのうちの 1 つを `provider_user_id` として保存する。**併せて `snippet.title` を `display_name` 列に保存する**（migration で追加）。
- 拡張機能側で OAuth トークンを取得・保管・転送する必要は **無い**。`chrome.identity.getAuthToken` も使わない。
- ユーザーが Google OAuth に与える scope（`youtube.readonly` 等）の管理は AuthCore 側 OAuth client の責務。

### 複数チャンネル登録の UX

- **1 OAuth フロー = 1 channel**。複数チャンネルを登録したいユーザーは「YouTube と連携」ボタンを **複数回押す** ことになる。
- 拡張機能側にチャンネル選択 UI は **作らない**（AuthCore 側 / Google 同意画面で実質的に対象 Google アカウントが切り替わる）。

### 同一 Google アカウントが複数 YouTube チャンネルを持つケース

- AuthCore 側の挙動は **`channels.list?mine=true` の `items[0]` を採用** する方針で確定（前回の AuthCore 確認回答による）。
- 理由: Google 同意画面で channel 選択 UI が出る前提が成立しており、複数件届くケースは実質ゼロと想定されるため。
- 万一複数届いた場合: AuthCore 側で `slog.Warn` ログを残す改修が AuthCore 側で追加される予定。**拡張機能側では特別なハンドリングを行わない**。
- 万一意図しない channel が登録された場合の修正手順:
  - 本来であれば「unlink → 再 OAuth」の動線で修正する想定だが、unlink 動線は次タスク（Dashboard で連携済み一覧から削除）で実装予定。
  - それまでは AuthCore 管理画面 / DB 直接操作で修正対応する旨をユーザー / 運用に伝える。

### 連携済み一覧表示の実装方針

- AuthCore 側の `GET /v1/user/social-accounts` 新設に伴い、Dashboard に「連携済み YouTube チャンネル」リストを **`display_name` で表示** する。
- 表示は YouTube provider 分のみ filter する。X / Google の連携済み表示は本タスクのスコープ外（将来的に同じデータソースから拡張可能）。
- レスポンス形式は AuthCore 側の確定スキーマで type を上書きする。本ドキュメントの想定形と乖離した場合は client / message / Dashboard の型を一括更新する。

### unlink について

- AuthCore は `DELETE /v1/auth/disconnect/{provider}/{provider_user_id}` を提供しているが、本タスクのスコープ外。
- 連携済み一覧から削除する UI 含めて次タスクで実装する。

### 関連既存コード（参照）

- `src/popup/auth/Dashboard.tsx` — link UI 埋め込み先 / `handleConnect` / `assertLinkSucceeded` / `formatLinkError` / 連携済み一覧 UI 追加先。
- `src/background/provider-manager.ts` — `handleGetConnectUrl`（provider 不問の作り）/ `handleGetSocialAccounts` 追加先。
- `src/background/message-handler.ts` — 既存 dispatch + 新規 case 追加先。
- `src/shared/auth/providers.ts` — `Provider` 型と `getConnectAuthorizeUrl`。
- `src/shared/auth/errors.ts` — `AuthErrorCode`。`SOCIAL_ALREADY_LINKED` 系の追加先。
- `src/shared/auth/client.ts` — `getProfile` と同じパターンで `getSocialAccounts` を追加。
- `src/shared/auth/messages.ts` — `PROVIDER_GET_CONNECT_URL` と同じ命名規則で `PROVIDER_GET_SOCIAL_ACCOUNTS` を追加。
- `src/shared/auth/types.ts` — `SocialAccount` / `SocialAccountsResponse` 型追加先。
- `public/manifest.json` — 変更不要。

### スコープ外（別タスク）

- **YouTube チャンネル unlink 動線**（`DELETE /v1/auth/disconnect/youtube/{channel_id}`）+ Dashboard 一覧の削除ボタン。
- **YouTube 上 / X 上での「認証済みチャンネル」アイコン表示**: 最終ゴール (b)。
- **YouTube プロバイダ経由の新規 Fuju ユーザー登録（サインアップ）**: 今回は link のみ。
- **X / Google の連携済み一覧表示**: 同じ API を流用すれば容易に拡張できるが、本タスクでは YouTube のみ表示。

---

## 想定 PR

1 PR で全 8 ファイル変更（manifest を除く）。差分は合計 100〜180 行程度（Dashboard の一覧 UI 分が支配的）。

- `src/shared/auth/providers.ts`: +数行（型 union 拡張 + JSDoc）。
- `src/shared/auth/errors.ts`: +2（コード追加）。
- `src/shared/auth/types.ts`: +約 10（型追加）。
- `src/shared/auth/client.ts`: +約 8（`getSocialAccounts` 追加）。
- `src/shared/auth/messages.ts`: +約 10（メッセージ + 型）。
- `src/background/provider-manager.ts`: +約 10（`handleGetSocialAccounts` 追加）。
- `src/background/message-handler.ts`: +約 6（dispatch case 追加）。
- `src/popup/auth/Dashboard.tsx`: +約 50〜100（ボタン追加 + switch 2 case + 一覧 UI + state + useEffect）。
- `public/manifest.json`: 変更なし。
