# X サイト訪問時のコンソールログ出力 (＋ サイト別ハンドラのディスパッチ基盤)

## 概要

X (`x.com` / `twitter.com` 系) のページが読み込まれたタイミングで content script からコンソールにログを出力する。あわせて、今後他サイト向け処理を追加する際にも同じ仕組みで拡張できるよう、**`location.host` を見てサイト別ハンドラへディスパッチする汎用ルーター** を導入する。

## 背景・目的

- 現状の `src/content/index.ts` は `<all_urls>` で実行され、全サイトに対して `console.log('[content] loaded on', location.href)` を出すだけの 1 行構成。
- 今後、X (x.com / twitter.com) を皮切りに、他のサイトに対しても固有の機能 (DOM 操作、要素検出、メッセージ送受信など) を追加していく予定。
- サイト固有処理を `src/content/index.ts` に直接書き足していくとファイルが肥大化し、サイト追加のたびに本体改修が必要になる。
- まずは X のページ訪問をログで確認できる状態を作ると同時に、**サイトハンドラを 1 ファイル足すだけで増やせる** ディスパッチ基盤を整える。

## 確定事項

ヒアリング結果として確定した方針:

1. **対象ホスト**: `x.com` / `*.x.com` に加えて `twitter.com` / `*.twitter.com` も対象に含める。両者は同一ハンドラを共有する。
2. **既存ログの扱い**: `src/content/index.ts` の `console.log('[content] loaded on', ...)` は削除しない。X 用ログは別レイヤー (専用ハンドラ) で `[fuju:x]` プレフィックスを付けて出す。
3. **ログ出力項目**: `url` / `host` / `readyState` を出力する。`userAgent` は `navigator.userAgent` でいつでも取得可能で重複情報になりやすいため初期実装からは外す (デバッグで必要になれば追加)。
4. **SPA URL 変化検知**: 本タスクに含める。検知ロジックはサイト共通ユーティリティとして提供し、各サイトハンドラから利用できる形にする。
5. **manifest 更新**: `public/manifest.json` の `host_permissions` に `https://twitter.com/*` と `https://*.twitter.com/*` を追加する (後述「manifest の更新」参照)。`content_scripts.matches` は `<all_urls>` のままで変更不要。

## 設計方針: サイトハンドラのディスパッチ機構

将来 X 以外のサイトでも同様のタスクが発生する想定のため、以下の構造を採る。

```
src/content/
├── index.ts              # エントリポイント。ルーターを起動するだけ
├── site-router.ts        # host を見て該当ハンドラを起動するディスパッチ層
├── site-handler.ts       # SiteHandler 型 (interface) と共通ユーティリティ
├── url-change.ts         # SPA URL 変化検知ユーティリティ (history API ラップ + popstate)
└── sites/
    ├── index.ts          # 登録済みハンドラの配列を export
    └── x.ts              # X (x.com / twitter.com) 用ハンドラ
```

### SiteHandler の型 (例)

```ts
export interface SiteHandler {
  /** ハンドラ識別用の名前 (ログ用) */
  name: string;
  /** マッチさせたいホストの集合。完全一致 or サフィックス一致で評価する */
  hosts: string[];
  /** 初回ロード時 (host 一致時) に呼ばれる */
  onLoad(ctx: SiteContext): void;
  /** SPA で URL が変化したときに呼ばれる (任意) */
  onUrlChange?(ctx: SiteContext): void;
}

export interface SiteContext {
  url: string;
  host: string;
  readyState: DocumentReadyState;
}
```

### ルーターの責務

- `sites/index.ts` から取得したハンドラ配列を走査し、現在の `location.host` にマッチする最初のハンドラを 1 つ起動する。
- マッチ判定は「`hosts` の各要素について、`host === entry || host.endsWith('.' + entry)` のいずれかが真」で行う (`x.com` 指定で `mobile.x.com` もマッチ)。
- 起動済みハンドラに対して、`url-change.ts` の検知イベントを `onUrlChange` として転送する。
- 「`location` で switch 文を回すのもあり」というユーザーの示唆を、配列ベースの宣言的ディスパッチ + `hosts` 配列マッチで一般化した形。

### 拡張時のフロー

新サイト `example.com` を追加したい場合:

1. `src/content/sites/example.ts` を新規作成し `SiteHandler` を default export
2. `src/content/sites/index.ts` の登録配列に追記
3. (必要なら) `public/manifest.json` の `host_permissions` を追加

`src/content/index.ts` 本体や `site-router.ts` は触らない。

## 影響範囲

破壊的変更なし。

### 新規ファイル

- `src/content/site-handler.ts` — `SiteHandler` / `SiteContext` 型の定義
- `src/content/site-router.ts` — host を見てハンドラをディスパッチ。SPA URL 変化を各ハンドラへ転送
- `src/content/url-change.ts` — `pushState` / `replaceState` ラップ + `popstate` リスナで URL 変化を通知する共通ユーティリティ (`onUrlChange(callback)` を export)
- `src/content/sites/index.ts` — 登録済みハンドラ配列の export
- `src/content/sites/x.ts` — X / Twitter 用ハンドラ。`hosts: ['x.com', 'twitter.com']`
- `src/content/sites/x-log.ts` (任意) — `[fuju:x]` プレフィックス付きロガー。`x.ts` 内に直接書いてもよい

### 既存ファイルの変更

- `src/content/index.ts` — 既存の汎用ログを残しつつ、`site-router.ts` の起動関数を呼び出す形に変更
- `public/manifest.json` — `host_permissions` に `https://twitter.com/*` と `https://*.twitter.com/*` を追加

### 変更しないが確認するもの

- `vite.config.ts` — content のエントリポイントは `src/content/index.ts` のままで、追加モジュールは Vite が自動でバンドルする
- `package.json` — 新規依存なし

## 実装ステップ

### Phase 1: 共通基盤 (型・ユーティリティ・ルーター)

1. `src/content/site-handler.ts` を作成し、`SiteHandler` と `SiteContext` を定義する。
2. `src/content/url-change.ts` を作成し、`pushState` / `replaceState` のラップ + `popstate` で URL 変化を検知する関数を提供する。
   ```ts
   export function onUrlChange(handler: (url: string) => void): () => void {
     const wrap = (key: 'pushState' | 'replaceState') => {
       const original = history[key];
       history[key] = function (this: History, ...args: Parameters<typeof original>) {
         const result = original.apply(this, args);
         queueMicrotask(() => handler(location.href));
         return result;
       } as typeof original;
       return original;
     };
     const origPush = wrap('pushState');
     const origReplace = wrap('replaceState');
     const popHandler = () => handler(location.href);
     window.addEventListener('popstate', popHandler);

     // クリーンアップ関数を返す (テストや解除時のため)
     return () => {
       history.pushState = origPush;
       history.replaceState = origReplace;
       window.removeEventListener('popstate', popHandler);
     };
   }
   ```
3. `src/content/site-router.ts` を作成し、以下を提供する。
   - `matchHost(host: string, hosts: string[]): boolean` — 完全一致 or サフィックス (`.example.com`) 一致
   - `startSiteRouter(handlers: SiteHandler[]): void` — 現在の `location.host` にマッチする最初のハンドラを起動し、`onUrlChange` を購読して該当ハンドラの `onUrlChange` を呼ぶ
   - 多重起動防止フラグを内包

### Phase 2: X / Twitter ハンドラ

4. `src/content/sites/x.ts` を作成し、以下のような `SiteHandler` を default export する。
   ```ts
   import type { SiteHandler, SiteContext } from '../site-handler';

   const PREFIX = '[fuju:x]';
   const log = {
     info: (...args: unknown[]) => console.log(PREFIX, ...args),
     warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
     error: (...args: unknown[]) => console.error(PREFIX, ...args),
   };

   const handler: SiteHandler = {
     name: 'x',
     hosts: ['x.com', 'twitter.com'],
     onLoad(ctx: SiteContext) {
       log.info('content script loaded on X', {
         url: ctx.url,
         host: ctx.host,
         readyState: ctx.readyState,
       });
     },
     onUrlChange(ctx: SiteContext) {
       log.info('url changed', { url: ctx.url });
     },
   };

   export default handler;
   ```
5. `src/content/sites/index.ts` を作成し、登録配列を export する。
   ```ts
   import type { SiteHandler } from '../site-handler';
   import x from './x';

   export const siteHandlers: SiteHandler[] = [x];
   ```

### Phase 3: エントリポイントの結線

6. `src/content/index.ts` を以下のように更新。
   ```ts
   import { startSiteRouter } from './site-router';
   import { siteHandlers } from './sites';

   console.log('[content] loaded on', location.href);

   startSiteRouter(siteHandlers);
   ```
   既存の汎用ログは保持。サイト固有処理は完全にハンドラ側へ分離。

### Phase 4: manifest の更新

7. `public/manifest.json` の `host_permissions` に以下を追加する。
   ```jsonc
   "host_permissions": [
     "http://localhost:8080/*",
     "https://auth.example.com/*",
     "https://*.fujupay.app/*",
     "https://fujupay.app/*",
     "https://x.com/*",
     "https://*.x.com/*",
     "https://twitter.com/*",
     "https://*.twitter.com/*"
   ]
   ```
   - 既存に `https://*.x.com/*` も無いため、サブドメイン対応として併せて追加 (mobile.x.com 等)。
   - `content_scripts.matches` は `<all_urls>` のままで変更不要 (注入はされるが、ハンドラがマッチしないサイトでは実質 no-op)。

### Phase 5: 動作確認

8. `npm run build` でビルドが通ることを確認。
9. Chrome の `chrome://extensions` で `dist/` を再読み込み。
10. `https://x.com/home` を開き、DevTools の Console に以下が出ることを確認:
    - `[content] loaded on https://x.com/home`
    - `[fuju:x] content script loaded on X { url: ..., host: 'x.com', readyState: ... }`
11. `https://twitter.com/` を開き、同様に `[fuju:x] content script loaded on X` が出ることを確認 (`host: 'twitter.com'`)。
12. X 内で別ページ (例: 任意のプロフィール) にクリック遷移し、`[fuju:x] url changed { url: ... }` が出ることを確認。
13. `https://www.google.com/` などの他サイトを開き、`[content] loaded on ...` のみが出て `[fuju:x]` ログが**出ない**ことを確認。

## 完了条件 (DoD)

- [ ] `x.com` / `*.x.com` / `twitter.com` / `*.twitter.com` のいずれを訪問しても `[fuju:x] content script loaded on X` がコンソールに出る
- [ ] X / Twitter 内の SPA 遷移で `[fuju:x] url changed` が出る
- [ ] X / Twitter 以外のサイトでは `[fuju:x]` プレフィックスのログが出ない (既存 `[content]` ログのみ)
- [ ] `manifest.json` の `host_permissions` に twitter.com / `*.twitter.com` / `*.x.com` が追加されている
- [ ] **新サイトのハンドラを追加する際、`src/content/sites/<新サイト>.ts` を新規作成し `src/content/sites/index.ts` の配列に追記するだけで動く構造になっている** (`src/content/index.ts` や `site-router.ts` の改修不要)
- [ ] X と Twitter が同一ハンドラ (`sites/x.ts`) を `hosts` 配列で共有している
- [ ] SPA URL 変化検知ロジックが `url-change.ts` に分離され、`site-router.ts` から各ハンドラの `onUrlChange` へ転送される構造になっている
- [ ] `npm run build` が通る

## テスト要件

自動テストの整備は本タスク範囲外 (現状リポジトリにテストランナー未導入)。手動確認は Phase 5 の手順 8〜13 で実施。

## 技術的な補足

### SPA 遷移検知の堅牢性

X / Twitter はクライアントサイドルーティングを採用しているため、`document_idle` での 1 度の起動だけでは遷移後の処理ができない。本タスクでは history API ラップ + `popstate` で対応するが、より堅牢な仕組みが必要になった場合の代替:

- `MutationObserver` で `<title>` や特定 DOM の変化を監視
- `chrome.webNavigation.onHistoryStateUpdated` を background で受け、content script へメッセージ送信

これらは X 機能追加が本格化したタイミングで `url-change.ts` を差し替える形で導入できる。

### ログレベル / 量の管理

将来的にサイトハンドラが増え、各ハンドラがログを大量に出すようになると DevTools が埋まる。共通ロガー (`[fuju:<site>]` プレフィックスの自動付与) を `site-handler.ts` 周辺に置き、`DEBUG` フラグ (環境変数 or `chrome.storage`) でフィルタできる仕組みを将来導入する余地を残しておくとよい。今回は最小実装で導入。

### host マッチの優先順位

複数ハンドラの `hosts` が重なるケース (例: 親ドメインと特定サブドメイン) は当面想定しないが、将来的に必要になった場合は「より具体的な (長い) ホスト名を持つハンドラを優先」する評価順を `site-router.ts` 側で実装する。
