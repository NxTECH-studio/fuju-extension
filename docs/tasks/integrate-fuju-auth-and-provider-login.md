# Fuju ユーザー判定 URL 化 + provider link 機能の追加（X / Google）

## 概要

- (1) X.com の content script から呼んでいる Fuju ユーザー判定 fetch を、AuthCore (`fuju-system-authentication`) の `/v1/users/lookup` エンドポイントに切り替える。
- (2) 既にログイン済みの Fuju アカウントに対して、AuthCore の `/v1/auth/connect/{provider}` フローで X / Google プロバイダを **紐づける（link する）** 機能を追加する。

新規ユーザー作成（provider 経由のサインアップ）、provider 解除（disconnect）、Fuju ユーザーのアイコン URL / 詳細情報の取得は本タスクの対象外。

## 背景・目的

- `src/content/api/fujuUserCache.ts` の `fujuData(userId)` が `fetch('/api/fuju-user/<userId>')` という **X.com 同一オリジンへの相対パス** で fetch しており、本番でも開発でも実際の AuthCore に届かない。確定仕様 (`/v1/users/lookup`) に置き換える必要がある。
- 認証基盤は identifier (email / public_id) + password ログイン + TOTP MFA までは整備済み。X / Google を「すでに作ったアカウントに紐づける」ユースケースは未実装。OpenAPI 仕様上 X は `SOCIAL_LINK_ONLY` で link 専用、Google は両用可だが本タスクは **link 動線のみ** に集中する。
- 環境変数は新設せず、既存の `VITE_AUTHCORE_BASE_URL` を共用する（ヒアリング Q1 = A 確定事項）。
- `fujuData()` のレスポンス契約は `{ exists: boolean }` のみであり、provider 連携先の情報（avatar など）はサーバー側 API が返さないため、本タスクのスコープでは戻り値型を `Promise<{ exists: boolean } | null>` に変更する（ヒアリング Q2 = B 確定事項）。
- disconnect UI は本タスクには含めない（ヒアリング Q3 = no 確定事項）。

## 影響範囲

新規追加が中心。既存ログイン／MFA フローには破壊的変更を入れない。

### 新規追加ファイル

- `src/shared/auth/providers.ts` — provider 種別 (`'x' | 'google'`)、AuthCore の `/v1/auth/connect/{provider}` 系のリクエスト／レスポンス型、`getConnectAuthorizeUrl(accessToken, provider)` / `completeConnectCallback(accessToken, provider, code, state)` の client 関数。link 専用、disconnect は含めない。
- `src/background/provider-manager.ts` — background 側で AuthCore へ link 用 fetch を発行するハンドラ群。`authenticatedFetch` を再利用しつつ、`/v1/auth/connect/{provider}` の **302 リダイレクト先（Location ヘッダ）を取り出す必要がある** ため、`fetch(..., { redirect: 'manual' })` を直接使う薄いラッパーをこのファイル内に持つ。

### 既存ファイルの変更

- `src/content/api/fujuUserCache.ts`
  - fetch 先を `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=<handle>` に変更。
  - `fujuData()` の戻り値型を `Promise<string | null>` から `Promise<{ exists: boolean } | null>` に変更。
  - キャッシュの値型も `Map<string, { exists: boolean }>` に変更。
- `src/content/x/userData.ts`
  - `fujuData()` の新戻り値型に合わせて呼び出し側を更新（`exists` が `true` のときのみアイコン表示を有効状態にする）。`dataset.fujuUserId` という名前は維持し、入る値だけ「`'true'` / `'false'` または `'null'`」のような真偽 string に意味替えする（フィールド名は据え置き）。
- `src/shared/auth/messages.ts`
  - `PROVIDER_GET_CONNECT_URL`、`PROVIDER_COMPLETE_CONNECT` の 2 種類の AuthMessage を追加（link フローのみ）。
  - 判別共用体 `AuthMessage` と `isAuthMessage` の型ガードに含める。
- `src/background/message-handler.ts`
  - 上記 2 メッセージを `provider-manager` にディスパッチ。エラーは既存 `toErrorPayload` でラップ。
- `src/popup/auth/Dashboard.tsx`
  - 「X と連携」「Google と連携」ボタンを追加。click ハンドラで `chrome.identity.launchWebAuthFlow` を起動し、終了 URL からクエリで `code` / `state` を回収して background の `PROVIDER_COMPLETE_CONNECT` に渡す。link 専用 UI、解除ボタンは出さない。
  - 連携成否を表示するための簡易ステータス表示 (`auth-error` / 成功メッセージ) を持つ。
- `public/manifest.json`
  - `permissions` に `"identity"` を追加。`host_permissions` は `VITE_AUTHCORE_BASE_URL` のホスト分が既に登録されているため追加不要（`http://localhost:8080/*` / `https://auth.example.com/*` を流用）。
- `docs/overview.md`
  - 「主要機能 → コンテンツスクリプト」の Fuju ユーザー判定 API の記述を `/v1/users/lookup` に更新。
  - 「メッセージプロトコル」表に `PROVIDER_GET_CONNECT_URL` / `PROVIDER_COMPLETE_CONNECT` を追記。
  - 「環境変数」表は変更なし（新変数は追加しない）。
  - 「既知の制約 / TODO」から `/api/fuju-user/<userId>` の記述を削除し、disconnect / 新規 provider 登録 / Fuju ユーザー詳細取得が未実装である旨を追記。

### 破壊的変更

- `fujuData()` の戻り値型変更に伴い、`src/content/x/userData.ts` 側の利用も同時更新する。型レベルの破壊的変更（戻り値の `string` 想定が `{ exists: boolean }` に変わる）。
- `fetch` の URL がクロスオリジンになるため、`VITE_AUTHCORE_BASE_URL` で指したホストが `host_permissions` に列挙されている必要がある（既存の `http://localhost:8080/*` / `https://auth.example.com/*` で間に合う想定）。

## 実装ステップ

### Phase 1: Fuju ユーザー判定 API の URL 化（先行実施可）

1. `src/content/api/fujuUserCache.ts` を改修する。
   - `import { AUTHCORE_BASE_URL } from '../../shared/config';` を追加。
   - fetch 先を `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=${encodeURIComponent(userId)}` に変更。
   - `userCache` を `Map<string, { exists: boolean }>` に変更。
   - `pendingRequests` を `Map<string, Promise<{ exists: boolean } | null>>` に変更。
   - `fujuData(userId)` の戻り値型を `Promise<{ exists: boolean } | null>` に変更。
   - `response.ok` 時はサーバー JSON を `{ exists: boolean }` として narrow し、それ以外は `{ exists: false }` あるいは `null`（fetch 失敗）として扱う。404 の扱いは「該当なし＝`{ exists: false }`」にするか「`null`」にするかを実装時に決める（推奨: 404 は `{ exists: false }`、ネットワーク失敗は `null`）。
2. `src/content/x/userData.ts` の呼び出しを更新する。
   - `const fujuUserId = await fujuData(userId);` の戻り値を `result` に名称変更。
   - `insertFujuIcon(username, fujuUserId)` のシグネチャを「2 値（exists or not）」に変更し、`dataset.fujuUserId` には旧来の値の代わりに `'true'` / `'false'`、結果不明時は `'null'` を入れる（dataset 名は据え置き、意味だけ「Fuju ユーザーかどうかの真偽値文字列」に読み替え）。
   - `console.log` 内のメッセージ文言も合わせて更新（任意）。
3. `host_permissions` を確認する。`VITE_AUTHCORE_BASE_URL` が `http://localhost:8080` 以外（例: `https://auth.example.com`）を指す場合は manifest にホストが登録済みかを確認する（既存の値で足りるため通常は変更不要）。
4. content script 側でも `import.meta.env.VITE_AUTHCORE_BASE_URL` がビルド時に埋め込まれることを `npm run build` で確認する。

### Phase 2: provider link 用クライアント整備

5. `fuju-system-authentication/docs/openapi.yml` の `/v1/auth/connect/{provider}` 仕様を再確認する（前回調査どおり：`Authorization: Bearer <access_token>` 必須、リダイレクト型）。
6. `src/shared/auth/providers.ts` を新規作成する。
   - `export type Provider = 'x' | 'google';`
   - `getConnectAuthorizeUrl(accessToken, provider)`:
     - `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}` に `Authorization: Bearer <token>` を付けて `fetch(..., { redirect: 'manual', credentials: 'include' })`。
     - `response.type === 'opaqueredirect'` の場合、Location は読み取れないため background で **`opaqueredirect` 検出時に再度リダイレクト追跡をしない fetch を試す**運用にする。実装方針案: AuthCore に `Accept: application/json` を投げて 302 ではなく JSON で `{ authorize_url: string }` を返すよう仕様調整する **か**、もしくは `chrome.identity.launchWebAuthFlow` の URL に直接 `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}` を渡し、AuthCore に `Authorization` を付けるために短期トークンを query にも入れる仕様にするか、いずれかをサーバ側と合わせて確定する。**この点は実装着手前にサーバ側と要調整**（「技術的な補足」参照）。
   - `completeConnectCallback(accessToken, provider, code, state)`:
     - `${AUTHCORE_BASE_URL}/v1/auth/callback/${provider}?code=...&state=...` を `Authorization: Bearer <token>` 付きで GET。
     - 200 系で成功扱い、エラー JSON を `AuthCoreApiError` に変換。
7. `src/shared/auth/messages.ts` に link 用メッセージを追加する。
   - `PROVIDER_GET_CONNECT_URL`：popup → background。背景で AuthCore から authorize URL を取得し popup に返す。
   - `PROVIDER_COMPLETE_CONNECT`：popup → background。`launchWebAuthFlow` で得た `code` / `state` を background に渡し、AuthCore へ callback 完了 GET を投げる。
   - `AuthMessage` の判別共用体 / `isAuthMessage` を更新。
   - 対応する `AuthResponse` データ型 (`ProviderGetConnectUrlResponseData = { authorizeUrl: string }`、`ProviderCompleteConnectResponseData = { provider: Provider }`) を追加。

### Phase 3: background ハンドラ追加

8. `src/background/provider-manager.ts` を新規作成する。
   - `handleGetConnectUrl(provider)`：`ensureAccessToken()` でトークン取得 → `getConnectAuthorizeUrl` 呼び出し → `{ authorizeUrl }` を返す。
   - `handleCompleteConnect(provider, code, state)`：`ensureAccessToken()` → `completeConnectCallback` 呼び出し → 成功なら `{ provider }` を返す。
   - 内部のトークン解決とエラー変換は `auth-manager.ts` の既存ヘルパ (`ensureAccessToken`, `AuthCoreApiError`) を再利用。
9. `src/background/message-handler.ts` の `dispatch` に `PROVIDER_GET_CONNECT_URL` / `PROVIDER_COMPLETE_CONNECT` 分岐を追加。

### Phase 4: manifest 更新

10. `public/manifest.json` の `permissions` に `"identity"` を追加（`launchWebAuthFlow` 利用のため）。
11. `host_permissions` は変更不要（`VITE_AUTHCORE_BASE_URL` で指すホストが既存に含まれていることを確認のみ）。

### Phase 5: Dashboard に link UI を追加

12. `src/popup/auth/Dashboard.tsx` に「X と連携」「Google と連携」のボタン 2 個を追加する。
    - click ハンドラの流れ:
      1. `chrome.runtime.sendMessage({ type: 'PROVIDER_GET_CONNECT_URL', payload: { provider } })` で authorize URL を取得。
      2. `chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true })` を呼ぶ。
      3. 戻ってきた redirect URL（`https://<extension-id>.chromiumapp.org/...`）から `URLSearchParams` で `code` と `state` を取り出す。
      4. `chrome.runtime.sendMessage({ type: 'PROVIDER_COMPLETE_CONNECT', payload: { provider, code, state } })` を呼ぶ。
      5. 成功時は「連携しました」メッセージを表示、失敗時は `auth-error` 風のエラー表示。
    - ボタンは popup 側で都度 click ハンドラから呼ぶ（`launchWebAuthFlow` はユーザー操作起点でないとキャンセル扱いになるため）。
    - 連携状態の保持や一覧取得 (`PROVIDER_LIST`) は本タスクでは行わない。連携後は単発のステータスメッセージのみ表示。
    - 解除ボタンは表示しない。
13. `disabled` 制御は `loading` フラグ（既存の `useAuth` 由来）に合わせる必要があるかを確認し、必要なら local state を追加。

### Phase 6: overview.md の更新

14. `docs/overview.md` を更新する。
    - 「主要機能 → コンテンツスクリプト（Fuju アイコン表示）」の `fetch('/api/fuju-user/<userId>')` の記述を `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=<userId>` に書き換え、レスポンスは `{ exists: boolean }` であることを明記。
    - 「メッセージプロトコル（popup ↔ background）」の表に下記 2 行を追加。
      - `AuthMessageType.PROVIDER_GET_CONNECT_URL` → `PROVIDER_GET_CONNECT_URL` → 背景で `/v1/auth/connect/{provider}` の authorize URL を取得
      - `AuthMessageType.PROVIDER_COMPLETE_CONNECT` → `PROVIDER_COMPLETE_CONNECT` → `launchWebAuthFlow` から得た code/state で `/v1/auth/callback/{provider}` を完了
    - 「既知の制約 / TODO」の Fuju ユーザー判定 API に関する古い記述を削除し、本タスクのスコープ外として下記を追記。
      - provider 経由の新規ユーザー登録は未実装（X は `SOCIAL_LINK_ONLY` のため不可、Google は別タスク）。
      - provider disconnect UI / API 配線は未実装（別タスク）。
      - Fuju ユーザーのアイコン URL / 詳細情報取得は未実装（API が `{ exists: boolean }` のみのため別 API 設計が必要）。

## テスト要件

### Phase 1（URL 化）
- ローカル AuthCore 起動状態で X.com を開き、`fujuData('<X handle>')` が `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=...` に GET を投げ、200 / 404 を切り分けて `{ exists: boolean }` を返すこと。
- `dataset.fujuUserId` が新仕様（真偽 string）で書き込まれ、アイコンの opacity が想定どおり切り替わること。
- ネットワークエラー時に `null` が返り、アイコンが「結果不明」表示になること。
- 既存の Map ベースキャッシュ・in-flight 共有が機能すること（同一 userId に対する連続呼び出しで fetch が 1 回だけ）。

### Phase 2-5（provider link）
- 既存ログイン済みユーザーが Dashboard の「X と連携」ボタンを押したとき、`launchWebAuthFlow` が AuthCore 経由で X の認可画面に遷移し、redirect 後 `PROVIDER_COMPLETE_CONNECT` まで到達して成功メッセージが出ること。
- 同 provider を二重連携しようとした場合の AuthCore エラーが popup にエラー表示として出ること。
- access_token 期限切れ中に link を実行しても、`ensureAccessToken` 経由で refresh が走り成功すること。
- `chrome.identity.launchWebAuthFlow` をユーザーキャンセルしたとき、popup でエラーメッセージが表示されること。
- Google についても同等に動作すること。

### 既存フローの非破壊性
- identifier + password ログイン、TOTP MFA、自動 refresh、logout が従来通り動作すること。
- content script 側のアイコン挿入が引き続き動作すること（`dataset.inserted` / `dataset.loading` の状態管理が壊れていない）。

## 技術的な補足

### `/v1/auth/connect/{provider}` 開始フローの認可ヘッダ問題

OpenAPI 仕様では `/v1/auth/connect/{provider}` は `Authorization: Bearer <access_token>` を要求しつつ 302 で provider の認可画面にリダイレクトする想定。`chrome.identity.launchWebAuthFlow(url, ...)` は **任意ヘッダを付与できない**ため、ブラウザ標準のリダイレクト追跡では `Authorization` を付けられない。実装上の選択肢:

- **(A) 二段構え案（本ドキュメント採用）**: background から `fetch('/v1/auth/connect/{provider}', { redirect: 'manual', headers: { Authorization } })` を呼んで Location を取得し、その URL を `launchWebAuthFlow` に渡す。`response.type === 'opaqueredirect'` の場合 Location が読めないため、AuthCore に「`Accept: application/json` のとき JSON で `{ authorize_url }` を返す」または「`Authorization` をヘッダではなく短期 query token として受け付ける」のどちらかの仕様調整を依頼する。
- (B) AuthCore 側に `GET /v1/auth/connect/{provider}/authorize-url` のような JSON エンドポイントを足してもらい、本拡張はそれを叩いて URL を得る。

どちらに着地するかは実装着手前に AuthCore チームと合意してから着手する。

### `chrome.identity.launchWebAuthFlow` の制約

- ユーザー操作起点（popup の onClick など）でないと `interactive: true` でも UI が出ないことがある。Dashboard の click ハンドラから直接呼ぶ。
- redirect URL は `https://<extension-id>.chromiumapp.org/...` 形式を AuthCore に登録する必要がある。AuthCore 側の callback 後の最終 redirect 先がこの URL になっていれば、`launchWebAuthFlow` の resolve に成功する。
- Service worker からは `chrome.identity` API を呼べないため、popup 側で起動する。

### `/v1/users/lookup` のクエリ仕様

ヒアリング Q1 の確定仕様として `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=<handle>` を採用。レスポンスは `{ exists: boolean }`。404 時のサーバー挙動（200 で `{ exists: false }` を返すか 404 を返すか）は OpenAPI を再確認し、`fujuData()` 側で吸収する。

### スコープ外（別タスク）

- **provider 経由の新規ユーザー登録**: X は `SOCIAL_LINK_ONLY` のため不可。Google は実装可能だが、サインアップ動線（メール確定 / public_id 採番 など）の UI が大きくなるため別タスク。
- **provider disconnect UI / API 配線**: ヒアリング Q3 で「含めない」と確定。
- **Fuju ユーザーのアイコン URL や詳細情報の取得**: API の戻り値が `{ exists: boolean }` のみで avatar 等を返さないため、別 API 設計が必要。本タスクでは exists 判定のみに留める。

### 関連既存コード（参照）

- `src/shared/auth/client.ts` — `fetchWithAccessToken` の実装パターン。providers.ts でも同等の `Authorization: Bearer` 付き fetch を行う。
- `src/background/auth-manager.ts` の `ensureAccessToken` / `authenticatedFetch` — 401 リトライ・refresh の既存挙動を踏襲。
- `src/popup/auth/Dashboard.tsx` — link UI 埋め込み先。
- `src/shared/config.ts` — `AUTHCORE_BASE_URL` をそのまま流用。
- `src/content/api/fujuUserCache.ts` — fetch 先と戻り値型の差し替え対象。
- `src/content/x/userData.ts` — `fujuData()` 呼び出し側の更新対象。

## 既知の確認事項（実装前にユーザー / AuthCore 側へ確認）

1. `/v1/auth/connect/{provider}` の authorize URL を `launchWebAuthFlow` に渡せる形（JSON で `{ authorize_url }` を返すか、または短期 query token に切替）にしてよいか（「技術的な補足」参照）。
2. `/v1/users/lookup` の 404 時の挙動（200 で `{ exists: false }` か 404 か）。
3. AuthCore の OAuth callback の最終 redirect 先として `https://<extension-id>.chromiumapp.org/` を登録できるか（chrome.identity で扱える URL 形式かどうかの担保）。
