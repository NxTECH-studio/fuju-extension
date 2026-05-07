# 現在閲覧中の YouTube チャンネルの検出と Fuju lookup 接続

## 概要

YouTube の `/watch` / `/@handle` / `/channel/UC…` / `/shorts/...` 各ページで「いま画面で見ているチャンネル」の identifier を抽出し、background 経由で `GET /v1/users/lookup?provider=youtube` を呼び出して登録済みかどうか判定できる導線を YouTube 用 content script に組み込む。アイコン UI 表示や impression tracker は本タスクのスコープ外で、後続タスクへ繋ぐ「データレイヤ」のみを完成させる。

## 背景・目的

- 現状の `src/content/youtube/index.ts` は `console.log('[content/youtube] loaded on', location.href);` だけの雛形（`docs/tasks/split-content-script-per-service.md` で着地）。
- AuthCore 側は `feat/users-lookup-x-youtube` のマージ済み実装で `GET /v1/users/lookup?provider=youtube&q=…` を受理しており、`q` には handle (`@MrBeast` / 生 `mrbeast`) と channel ID (`UC…22 文字`) のいずれも渡せる（`docs/flows/users-lookup.md`）。
- 拡張機能側の lookup 経路 (`src/background/fuju-lookup.ts`) は **`provider=x` がハードコード** されており、YouTube 用に provider を切り替えられない。
- 後続の「アイコン UI 表示」「impression tracker」「YouTube 投げ銭」などは「現在見ているチャンネルが特定できる」「lookup の結果が取れる」という前提に立つため、本タスクで先にこのデータレイヤを敷く。

## 影響範囲

### 既存ファイルの変更

- `src/shared/auth/messages.ts`
  - `FujuUserLookupPayload` を `{ userId: string }` から `{ provider: 'x' | 'youtube'; q: string }` に変更（または `userId` を残して `provider` を任意追加し、`provider` 省略時は `x` 互換）。**破壊的変更を最小化するために後者の互換戦略を推奨**（後述「技術的な補足」）。
- `src/background/fuju-lookup.ts`
  - `lookupFujuUser(userId)` のシグネチャを `lookupFujuUser({ provider, q })` に拡張し、URL 生成を `?provider=${provider}&q=${encodeURIComponent(q)}` にする。`provider=x` 経路は呼び出し側互換のために維持。
- `src/background/message-handler.ts`
  - `FUJU_USER_LOOKUP` ケースのペイロード分解を新シグネチャに合わせる。
- `src/content/shared/api/fujuUserCache.ts`
  - キャッシュキーを **provider 込み** にする（X の `userId` と YouTube の handle / channel ID が衝突しないように `${provider}:${q}` をキーとする）。
  - 公開 API `fujuData(userId)` を `fujuData({ provider, q })` または `fujuData(provider, q)` に拡張。X 側 (`src/content/x/userData.ts`) の呼び出しを合わせて更新。
- `src/content/youtube/index.ts`
  - 雛形の console.log のみだったエントリに、本タスクで実装するチャンネル検出ロジックと lookup 呼び出しを組み込む。
- `src/content/x/userData.ts`
  - `fujuData(userId)` → `fujuData({ provider: 'x', q: userId })` 等のシグネチャ変更に追従。

### 新規追加

- `src/content/youtube/channelIdentifier.ts` — 現在閲覧中のチャンネルを抽出するユーティリティ。`extractCurrentChannel(): { handle?: string; channelId?: string } | null` を export。ページ種別判定（`/watch` / `/@handle` / `/channel/UC…` / `/shorts/`）と DOM 抽出ロジックを集約。
- `src/content/youtube/navigation.ts` — YouTube SPA の遷移検知ユーティリティ。`onChannelContextChange(handler)` を export し、URL 変化と `yt-navigate-finish` カスタムイベントの両輪で「閲覧中チャンネルが変わったかもしれない」タイミングを通知する。
- （任意）`src/content/youtube/__tests__/channelIdentifier.fixture.html` 等のスナップショット — 実 DOM 例を控える。テストを書くかどうかは後述「テスト要件」を参照。

### 変更しないもの（このタスクのスコープ外）

- アイコン UI（`createRegisteredIcon` 等）の YouTube 上の表示 → **次タスク**。
- impression tracker（telemetry の item_id フォーマット決定含む）→ **次々タスク**。
- 共同投稿 (`/watch` の collab) チャンネルの DOM 抽出と UI 表示 → **次タスク（アイコン UI）に結合**して扱う。本タスクでは「共同投稿が存在するかを DOM 上認識する観察結果」のみ調査メモとして残し、UI には反映しない。
- `manifest.json` の `content_scripts` / `host_permissions` → 既存設定で YouTube 全ドメインがカバー済みのため変更なし。

### 破壊的変更

- `FujuUserLookupPayload` のフィールド変更は **拡張機能内部のみで完結**するため、外部 API 互換は問題なし。ただし X 用の既存呼び出し (`src/content/x/userData.ts` → `fujuData(userId)`) は同じコミットでまとめて修正する必要がある（古い呼び方を残すと型エラーになる）。
- AuthCore 側 (`../fuju-system-authentication`) の API 仕様には**手を入れない**（`/v1/users/lookup?provider=youtube&q=…` は既に受理されている）。

## 実装ステップ

### Phase 1: lookup 経路の provider 化（X / YouTube 共通の土台）

1. `src/shared/auth/messages.ts` の `FujuUserLookupPayload` を以下に変更。
   ```ts
   export interface FujuUserLookupPayload {
     provider: 'x' | 'youtube';
     q: string;
   }
   ```
   `userId` を残す互換戦略を取る場合は `provider?: 'x' | 'youtube'; q?: string; userId?: string;` の union とし、background 側で `q ?? userId` を採用する（推奨：互換維持で 1 PR で X 側まで強制移行しない選択肢を残す）。
2. `src/background/fuju-lookup.ts` の `lookupFujuUser` を `({ provider, q })` 受け取りに変更。URL を `/v1/users/lookup?provider=${provider}&q=${encodeURIComponent(q)}` に置き換え。
3. `src/background/message-handler.ts` の `FUJU_USER_LOOKUP` ケースで新ペイロードを `lookupFujuUser` に渡す。
4. `src/content/shared/api/fujuUserCache.ts` を以下のとおり拡張。
   - 内部キャッシュキーを `${provider}:${q}` に変更。
   - 公開 API を `fujuData(provider: 'x' | 'youtube', q: string)` に変更（呼び出しサイトが少ないので素直に positional 引数で OK）。
   - `sendLookup` を新ペイロード（`{ provider, q }`）に合わせる。
5. `src/content/x/userData.ts` の `fujuData(userId)` 呼び出しを `fujuData('x', userId)` に変更。X 側の動作確認を（実機で）行う。

### Phase 2: チャンネル identifier 抽出ロジック

YouTube DOM はセレクタが頻繁に変わるため、複数経路をフォールバックさせる **Robust extraction** を方針とする。

6. `src/content/youtube/channelIdentifier.ts` を新規作成し、`extractCurrentChannel(): ChannelIdentifier | null` を実装。返り値:
   ```ts
   export interface ChannelIdentifier {
     handle?: string;     // "@" 抜きの小文字 (`mrbeast`)
     channelId?: string;  // `UC` で始まる 24 文字
   }
   ```
   page kind ごとの抽出規則:
   - **`/watch`**: 動画下のチャンネル行 `ytd-watch-metadata #owner ytd-video-owner-renderer a.ytd-video-owner-renderer` の `href` を読む。`href` が `/@handle` なら `handle`、`/channel/UC…` なら `channelId` を採用。**collab（共同投稿）の DOM が存在するかどうかは観察ログだけ残す**（UI は次タスク）。
   - **`/@handle` / `/channel/UC…`**: `location.pathname` から直接抽出（`/@(\w[\w._-]{2,29})` または `/channel/(UC[\w-]{22})`）。SPA navigation 直後で URL がまだ更新されていないケースに備え、ページヘッダ `ytd-channel-name a` の href も併用してフォールバック。
   - **`/shorts/<id>`**: 投稿者リンク `ytd-reel-player-header-renderer a[href^="/@"]`、または overlay 上の `ytd-reel-video-renderer ytd-channel-name a`。`/@handle` を採用。
7. 抽出規則は **handle 優先、channel ID は fallback** とする（推奨案・後述）。両方取れる場合は `{ handle, channelId }` を両方返し、呼び出し側が好きな方を使えるようにする。
8. ヘルパー関数として以下を切り出す（テスタブル）:
   - `parseChannelHrefToIdentifier(href: string): ChannelIdentifier | null` — `/@handle` / `/channel/UC…` を URL string から抽出。
   - `getPageKind(): 'watch' | 'channel' | 'shorts' | 'other'` — `location` を見て分岐。

### Phase 3: SPA 遷移検知

YouTube は完全に SPA で動くため、document_idle で 1 回スキャンするだけでは不十分。

9. `src/content/youtube/navigation.ts` を新規作成し、`onChannelContextChange(handler: () => void): () => void` を実装。**推奨案：URL 変化の polling + `yt-navigate-finish` カスタムイベント + `pushState/replaceState` patch の三段構え**（後述）。
10. content script エントリ (`src/content/youtube/index.ts`) で:
    - `extractCurrentChannel()` を初回スキャン時に呼ぶ。
    - `onChannelContextChange(scan)` を登録し、`scan` 内で `extractCurrentChannel()` を呼び直す。
    - DOM が遅延描画される `/watch` の `ytd-video-owner-renderer` 等は `MutationObserver` で `document.body` の `subtree=true, childList=true` を観察し、`extractCurrentChannel()` が成功するまで再試行する（一定回数 / タイムアウトで諦める）。
11. デバウンスして同一 identifier への重複 lookup を防ぐ（直前と同じ `${provider}:${q}` ならスキップ。`fujuUserCache` 側のキャッシュも効くが、デバウンスは UX のため）。

### Phase 4: lookup 接続

12. `src/content/youtube/index.ts` で抽出した identifier を使って `fujuData('youtube', q)` を呼ぶ。
    - `q` の選び方は以下を推奨（後述）:
      - `handle` が取れていればそれを使う（`@` を剥がした生 handle）。
      - `handle` が取れず `channelId` のみの場合は `channelId` を使う。
13. 結果はとりあえず `console.log` でデバッグ可視化するに留める（UI は次タスク）。例：`console.log('[fuju/youtube] lookup', { provider: 'youtube', q, exists })`。
14. 未ログイン / ネットワーク失敗で `null` が返るケースを正常系（「結果不明」）として扱い、エラーを投げない。

### Phase 5: 動作確認

15. `npm run build` を実行し、`dist/content-youtube.js` がビルドできること、`dist/background.js` の lookup 部分のサイズに変化があることを確認。
16. 実機 (chrome://extensions で `dist/` を読み込み) で以下のケースを目視確認:
    - `https://www.youtube.com/watch?v=…`（自分のチャンネルが連携済み・別チャンネルが未連携）
    - `https://www.youtube.com/@MrBeast` および `https://www.youtube.com/@MrBeast/videos`
    - `https://www.youtube.com/channel/UC…`
    - `https://www.youtube.com/shorts/<id>`
    - 同一タブで `/@channel-a` → 動画クリック → `/watch?v=…` → 別動画 → `/@channel-b` の SPA 遷移を行い、毎回 `[fuju/youtube] lookup` が出るか
    - X 側 (`https://x.com/`) でも従来通りアイコンが出ること（Phase 1 の互換性確認）

## テスト要件

- **手動 E2E**: Phase 5 の手順 16。各ページ種別で console に `[fuju/youtube] lookup { provider, q, exists }` が出力されること。SPA 遷移ごとに新しいログが出ること。
- **静的検査**: `npm run lint` で型エラー / 未使用 import が無いこと。
- **単体テスト**（任意・推奨）: `parseChannelHrefToIdentifier` と `getPageKind` は純粋関数なので、最小限のスナップショット入力で table-driven test を書けると後の DOM 変更検知が効く。ただしリポジトリにまだ vitest / jest セットアップが無い場合は本タスクでは導入しない（別タスク）。
- **互換性**: X 側の Fuju アイコン挿入が引き続き動作すること（Phase 1 のリファクタが破壊的に効いていないことの保証）。

## 技術的な補足

### planner 推奨案 (b): identifier 優先順位

**handle 優先 → channel ID fallback** を推奨する。理由:

- `/@handle` ページ・`/shorts` ページ・`/watch` の owner anchor では handle のほうが安定して取れる。
- AuthCore 側の `parseYouTube` は **handle と channel ID の両方を受理**（`docs/flows/users-lookup.md`）。サーバ側で正規化されるため、拡張側で UC 解決を強制する必要が無い。
- `/channel/UC…` の URL 形式はカスタム URL 未設定ユーザーで頻出するため、**そのページに限り channel ID を採用** する（本来は handle が取れないので自動的に channel ID にフォールバックする）。
- 実装コストとして DOM クエリが少なくて済むのも handle 優先の利点。

ただし `display_name`（チャンネル名）を将来 UI で出すケースを見据えると、**channel ID も同時に取れていれば両方返す** のが良い（`ChannelIdentifier` を `{ handle?, channelId? }` で表現する理由）。アイコン UI タスク以降で「両方返ってくるなら handle を q に使う」「channel ID は telemetry の item_id 構築に使う」という分岐ができる。

### planner 推奨案 (c): SPA 遷移検知

YouTube SPA は `yt-navigate-finish` カスタムイベントを `document` 上で発火する（公式ドキュメントは無いが、Tampermonkey スクリプト等で広く使われている事実上の API）。ただし将来削除されるリスクがあるため、**多重防御**として以下を組み合わせる:

1. `document.addEventListener('yt-navigate-finish', handler)` — 主経路。
2. `history.pushState` / `history.replaceState` を patch して呼び出し時にイベント発火 — フォールバック。
3. `popstate` イベントの listen — ブラウザの戻る / 進む対応。
4. `setInterval(() => { if (location.href !== last) fire(); }, 500)` — 最終保険（デバッグログを出すだけで stop してもよい）。

`MutationObserver` は「DOM が完成するまで待つ」目的で別個に使う（チャンネル行が遅延 hydration されるケース）。SPA 遷移検知そのものに `MutationObserver` を全面的に依存させると無駄に発火が多くなるので避ける。

### `FujuUserLookupPayload` 互換戦略の判断

- **完全切り替え案** (`{ provider, q }` のみ): 型がきれい。X 側コードを同じ PR でまとめて修正できれば破壊なし。**推奨**。
- **互換 union 案** (`provider?` + `q?` + `userId?`): 段階的移行ができるが、background / cache キーの分岐が増えて読みにくい。

呼び出しサイトは X 側 1 箇所 (`fujuData`) しかないため、**完全切り替え案**で十分。本タスク内で X 側の呼び出しを `fujuData('x', userId)` に書き換える。

### 共同投稿 (collab) の扱い

`/watch` ページの `ytd-watch-metadata` 内には `secondaryInfoRenderer` で複数のチャンネルが並ぶケースがある（共同投稿 / featured channel）。本タスクでは:

- `extractCurrentChannel()` は **メインのチャンネルのみ**返す（`#owner` 配下の最初の anchor）。
- 共同投稿 DOM の存在確認は `console.debug('[fuju/youtube] collab detected', secondaryChannels)` 等のログ出力で済ませ、UI には反映しない。
- 「共同投稿チャンネルにもアイコンを出すか」の判断は次タスク（アイコン UI）に委ねる。

### telemetry item_id フォーマット

本タスクのスコープ外。`/watch` / `/shorts` は `<videoId>:<channelId>`、チャンネルページは `<channelId>` のみ、というユーザー意向は「impression tracker タスク」で確定させる。本タスクでは識別子を取得して lookup を通すところまで。

### 関連ファイル

- `D:\Docment\program\fuju\fuju-extension\src\content\youtube\index.ts`（実装エントリ・改修対象）
- `D:\Docment\program\fuju\fuju-extension\src\content\shared\api\fujuUserCache.ts`
- `D:\Docment\program\fuju\fuju-extension\src\background\fuju-lookup.ts`
- `D:\Docment\program\fuju\fuju-extension\src\background\message-handler.ts`
- `D:\Docment\program\fuju\fuju-extension\src\shared\auth\messages.ts`
- `D:\Docment\program\fuju\fuju-extension\src\content\x\userData.ts`（X 側互換修正対象）
- `D:\Docment\program\fuju\fuju-extension\src\content\x\index.ts`（X content script エントリ・参照のみ）
- `D:\Docment\program\fuju\fuju-extension\public\manifest.json`（参照のみ。変更不要）
- `D:\Docment\program\fuju\fuju-extension\vite.content.youtube.config.ts`（参照のみ）

### 関連ドキュメント

- `D:\Docment\program\fuju\fuju-system-authentication\docs\flows\users-lookup.md`（YouTube `q` の正規化・受理仕様の一次ソース）
- `D:\Docment\program\fuju\fuju-system-authentication\docs\tasks\youtube-auth-and-channel-lookup.md`（AuthCore 側の YouTube 対応経緯）
- `D:\Docment\program\fuju\fuju-extension\docs\tasks\link-youtube-channels.md`（拡張側 YouTube link フローの実装履歴）
- `D:\Docment\program\fuju\fuju-extension\docs\tasks\split-content-script-per-service.md`（YouTube content script 雛形を作った前タスク）

## 今後の関連タスク（保留事項の切り出し）

本タスクで取り扱わず、後続タスクで決める / 実装する事項:

1. **アイコン UI 表示（次タスク予定）**
   - YouTube 上で登録済み / 未登録 / ローディングのアイコンをどこに挿入するか（`/watch` の owner 行 / チャンネルヘッダ / shorts overlay）。
   - 共同投稿のサブチャンネルにアイコンを出すかどうか、出す場合の DOM ターゲット。
   - X と同じ `createRegisteredIcon / createUnregisteredIcon / createLoadingIcon` を流用できるか、YouTube 用に視認性を調整すべきか。

2. **impression tracker（次々タスク予定）**
   - `view_start` / `view_end` / `scroll_stop` の発火ターゲット（動画プレイヤー、shorts セル、チャンネルカード）。
   - `item_id` フォーマット（`<videoId>:<channelId>` / `<channelId>` の使い分け）。
   - 動画再生という「continuous content」に対する telemetry 設計（X とは異なる）。

3. **YouTube 独自投げ銭機能**
   - 別タスク。本タスクで作ったチャンネル identifier 抽出ユーティリティを再利用する想定。

4. **テストインフラ**
   - vitest / jsdom 等の導入。`channelIdentifier` などの純粋関数を table-driven でテストできるようにする。
