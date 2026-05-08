# content script のサービス別分割（X / YouTube）

## 概要

content script を「X (x.com / twitter.com)」と「YouTube (youtube.com / m.youtube.com / youtu.be)」の 2 サービスに分割し、それぞれ独立した content script としてビルド・配信する。manifest の `content_scripts` も 2 エントリに分け、開いているページに応じて固有のスクリプトのみが実行されるようにする。YouTube 側は今回は雛形のみ実装する。

## 背景・目的

- 現状の `src/content/index.ts` は `location.href` を見て分岐する単一エントリ構成で、X 用ロジックしか持っていない。
- YouTube 等の別サービス対応を追加するにあたり、サービスごとにコードを物理的に分離したい。
- 不要なサイト上で他サービスのコードがロードされないようにし、ビルド成果物・実行時コストを最小化したい。
- 認証 / アカウント連携 (`src/popup/`, `src/background/`, `src/shared/auth/`) は影響を受けず現状維持。

## 影響範囲

### 新規追加

- `src/content/x/index.ts` — 既存 `src/content/x/index.ts`（既にエントリ実体は存在）を X content script の **エントリポイント**として `bootstrap()` を export し、自身でも即時実行するよう調整
  - もしくは `src/content/x/main.ts` のような専用の bootstrap ファイルを新設し、`index.ts` はそのまま X 内部実装の集約として残す
  - 最終的には `vite.content.config.ts` の input が指す `src/content/x/index.ts` がエントリとして直接 console.log + `x()` を呼ぶ形にする
- `src/content/youtube/index.ts` — YouTube 用 content script のエントリ（**雛形のみ**: `console.log('[content/youtube] loaded on', location.href);` に類するログのみ）
- `src/content/shared/api/fujuUserCache.ts` — 既存 `src/content/api/fujuUserCache.ts` を移動
- `src/content/shared/api/telemetryQueue.ts` — 既存 `src/content/api/telemetryQueue.ts` を移動
- `src/content/shared/img/loadingIcon.ts` — 既存 `src/content/img/loadingIcon.ts` を移動
- `src/content/shared/img/registeredIcon.ts` — 既存 `src/content/img/registeredIcon.ts` を移動
- `src/content/shared/img/unregisteredIcon.ts` — 既存 `src/content/img/unregisteredIcon.ts` を移動

### 既存ファイルの変更

- `src/content/index.ts` — **削除**（switch 分岐エントリは不要になる。manifest 側で各サービスの content script を直接ロードする）
- `src/content/x/userData.ts` — import パスを `../img/*` → `../shared/img/*`、`../api/fujuUserCache` → `../shared/api/fujuUserCache` に変更
- `src/content/x/impressionTracker.ts` — import パスを `../api/telemetryQueue` → `../shared/api/telemetryQueue` に変更
- `src/content/x/index.ts` — 現状の `x` 関数を即時起動するエントリへ変更（`console.log('[content/x] loaded on', location.href);` ＋ `x()` 呼び出し）。または `index.ts` は実装関数の export のみ残し、別途 bootstrap ファイル（例: `bootstrap.ts`）を新設してそれを vite の input にする。**実装ステップ §3 で前者に統一する**。
- `vite.content.config.ts` — `input` を multi-entry にし、`src/content/x/index.ts` と `src/content/youtube/index.ts` を別々のチャンクとしてビルド。出力名は `content-x.js` / `content-youtube.js`。`format: 'iife'` と `inlineDynamicImports: true` は維持（MV3 content script は ESM 不可）。`emptyOutDir: false` も維持。
- `public/manifest.json` — `content_scripts` を 2 つに分割
  - X 用: `matches: ["https://x.com/*", "https://*.x.com/*", "https://twitter.com/*", "https://*.twitter.com/*"]`, `js: ["content-x.js"]`
  - YouTube 用: `matches: ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://youtube.com/*", "https://youtu.be/*"]`, `js: ["content-youtube.js"]`
  - `host_permissions` にも YouTube ドメインを追加（fetch / 将来の API 呼び出し向け。最低限 `https://*.youtube.com/*` を入れる。`youtu.be` は redirect 専用なので host_permissions には不要だが matches には入れる）
- `public/_locales/ja/messages.json`, `public/_locales/en/messages.json` — 影響なし（content script 切り出しは UI 文言には影響しない）。要確認のみ。

### 破壊的変更

- ビルド成果物のファイル名変更（`dist/content.js` → `dist/content-x.js` + `dist/content-youtube.js`）。CI / リリースフローで content.js を直接参照している箇所がないか確認。
- `src/content/index.ts` の削除に伴い、外部から `import './content'` 等で依存しているコードがないこと（grep で確認）。

## 実装ステップ

### Phase 1: 共通コードの shared 化

1. `src/content/shared/api/` ディレクトリを作成し、`fujuUserCache.ts` / `telemetryQueue.ts` を移動。
2. `src/content/shared/img/` ディレクトリを作成し、`loadingIcon.ts` / `registeredIcon.ts` / `unregisteredIcon.ts` を移動。
3. 移動後、`src/content/api/` と `src/content/img/` の旧ディレクトリを空にして削除。
4. 移動したファイル内の相対 import を更新する。
   - `fujuUserCache.ts`: `../../shared/auth/messages` → `../../../shared/auth/messages`（階層が 1 つ深くなるため）
   - `telemetryQueue.ts`: `../../shared/auth/messages` → `../../../shared/auth/messages`、`../../shared/telemetry/types` → `../../../shared/telemetry/types`
5. 共通コードを参照する側 (`src/content/x/userData.ts`, `src/content/x/impressionTracker.ts`) の import パスを `../shared/api/...`, `../shared/img/...` に修正。

### Phase 2: X 用エントリの再構成

6. `src/content/x/index.ts` を「X 用 content script のエントリ」として整理する。
   - 旧 `src/content/index.ts` がやっていた `console.log('[content] loaded on', ...)` を `console.log('[content/x] loaded on', location.href)` として組み込む。
   - module top-level で `x()` を即時呼び出す。
   - `default export` は残しても良いが、エントリとしての副作用実行が主目的。
7. `src/content/index.ts` を削除する（switch 分岐は manifest 側に移管されるため不要）。

### Phase 3: YouTube 用エントリの新設（雛形）

8. `src/content/youtube/` ディレクトリを作成し、`src/content/youtube/index.ts` を新規作成する。内容は最小:
   ```ts
   console.log('[content/youtube] loaded on', location.href);
   // 今後: チャンネル/動画への Fuju アイコン挿入、impression tracker 等を実装予定
   ```
9. **import は不要**（雛形なので shared にも依存しない）。型エラーが出ないよう `// eslint-disable-next-line` 等は使わず、純粋な console.log のみで完結させる。

### Phase 4: vite ビルド構成の更新

10. `vite.content.config.ts` の `rollupOptions.input` を multi-entry に変更:
    ```ts
    input: {
      'content-x': resolve(__dirname, 'src/content/x/index.ts'),
      'content-youtube': resolve(__dirname, 'src/content/youtube/index.ts'),
    },
    ```
11. `output.entryFileNames` を `'[name].js'` に変更し、`content-x.js` / `content-youtube.js` として出力されることを確認。
12. `format: 'iife'` と `inlineDynamicImports: true` は維持。**ただし `inlineDynamicImports` は multi-entry と排他なので、`output.format` を `'iife'` のまま multi-entry にする場合は `inlineDynamicImports` を外し、代わりに各エントリで動的 import を使わない設計を維持する**（現状コードは静的 import のみなので問題なし）。
    - 代替案: `output` を関数形式にして entry ごとに `inlineDynamicImports: true` を立てる方法もあるが、現状コードでは不要。
13. `output.format` を `'iife'` に保ったまま、shared chunk が生成されないよう `output.manualChunks: undefined` または `false` を明示するか、`preserveModules: false` を確認。MV3 content script は外部 chunk を読めないため、各エントリは自己完結 IIFE である必要がある。
    - 必要なら rollup の `output.inlineDynamicImports` 代わりに各エントリを別 build invocation に分けることも検討（最終手段）。
14. `npm run build` を実行し、`dist/content-x.js` と `dist/content-youtube.js` の 2 ファイルが生成されること、それぞれが IIFE で自己完結していることを確認する。

### Phase 5: manifest の content_scripts 分割

15. `public/manifest.json` の `content_scripts` を以下に置き換える:
    ```json
    "content_scripts": [
      {
        "matches": [
          "https://x.com/*",
          "https://*.x.com/*",
          "https://twitter.com/*",
          "https://*.twitter.com/*"
        ],
        "js": ["content-x.js"],
        "run_at": "document_idle"
      },
      {
        "matches": [
          "https://www.youtube.com/*",
          "https://m.youtube.com/*",
          "https://youtube.com/*",
          "https://youtu.be/*"
        ],
        "js": ["content-youtube.js"],
        "run_at": "document_idle"
      }
    ]
    ```
16. `host_permissions` に YouTube ドメインを追加:
    - `"https://*.youtube.com/*"`
    - 既存の auth/emotion-model/x のエントリは維持。

### Phase 6: 動作検証

17. `npm run build` を実行し、以下を確認:
    - `dist/content-x.js`, `dist/content-youtube.js` が生成される。
    - `dist/manifest.json` が更新後の内容を含む。
    - `dist/background.js`, `dist/popup.html` 等は影響を受けていない。
18. Chrome の `chrome://extensions` で `dist/` を読み込み直し、以下を確認:
    - `https://x.com/...` を開いた時、DevTools console に `[content/x] loaded on ...` が出力され、ツイートに Fuju アイコンが挿入され、impression tracker が動作する。
    - `https://www.youtube.com/` を開いた時、DevTools console に `[content/youtube] loaded on ...` のみが出力される。X 用のコード（fuju アイコン等）はロード/実行されない。
    - 双方のサイトで popup の認証 UI が従来通り動作する（認証回りには手を入れていないため）。
19. `chrome://extensions` の「サービスワーカー / content scripts」インスペクタで、サイトごとに正しい js のみが注入されていることを確認。

## テスト要件

- **手動 E2E**: Phase 6 の手順 17〜19。
- **静的検査**: `npm run lint` で旧 import パスの参照が残っていないことを保証。
- **ビルド検査**: `dist/content-x.js` / `dist/content-youtube.js` が IIFE 形式（先頭 `(function(){` または `!function(){`）で出力されていること。`import` / `export` 文が残っていないこと（MV3 content script は ESM 不可）。

## 技術的な補足

### MV3 content script のバンドル制約

- MV3 の content script は ES module 解決を行わないため、**各 content script ファイルは自己完結した IIFE** である必要がある（`vite.content.config.ts` の現状コメント参照）。
- multi-entry にしたとき rollup が共通モジュール（`shared/api/*`）を別チャンクに切り出すと content script が読み込みに失敗する。`format: 'iife'` 単独では `manualChunks` を抑制する保証がないため、ビルド出力を必ず確認する。
- 共通モジュールが各 IIFE 内に重複してインライン化される（多少のサイズ重複）のは許容する。実体は数 KB なので問題なし。
- どうしても shared chunk が分離されてしまう場合は、`vite.content.config.ts` を「x 用」「youtube 用」の 2 ファイルに分け、`package.json` の `build` スクリプトを `vite build && vite build --config vite.content.x.config.ts && vite build --config vite.content.youtube.config.ts` に拡張する案も検討（最終手段）。

### youtu.be ドメインの扱い

- `youtu.be/<id>` は `youtube.com/watch?v=<id>` への redirect 専用ドメインで、最終的な navigation は `youtube.com` に着地する。content script が必要な実行コンテキストは事実上 `youtube.com` 系のみだが、念のため `matches` に含めておく（remote control redirect でなく client-side navigation の場合のみ意味がある）。
- `host_permissions` には fetch 対象とする想定がない限り `youtu.be` は不要。

### 既存の認証 / アカウント連携

- `src/popup/`, `src/background/`, `src/shared/auth/` は本タスクで一切変更しない。
- content script から background への message passing (`AuthMessageType.FUJU_USER_LOOKUP` 等) は X 側で従来通り動作する。YouTube 側は雛形なので messaging もまだ呼ばない。

### 命名規則

- ビルド成果物名は **`content-<service>.js`** に統一する。将来サービスを追加する場合 (`content-tiktok.js` 等) も同じパターンで拡張可能。
- `src/content/<service>/index.ts` を各サービスのエントリとし、`vite.content.config.ts` の `input` キー名と manifest の `js` ファイル名を一致させる。

### 想定されるはまりどころ

1. `vite.content.config.ts` を multi-entry にすると `inlineDynamicImports: true` が rollup から拒否される可能性がある。その場合は `inlineDynamicImports` を外して、代わりに動的 import を使わない設計を維持する（現状コードは問題なし）。
2. shared モジュールが別チャンクに切り出される問題は、`output.manualChunks: () => null` を指定すると緩和できる場合がある。ビルド結果を必ず確認する。
3. `src/content/index.ts` を削除した直後に tsc --build がキャッシュ上で残骸を見ようとしてエラーを出すことがあるので、その場合は `tsconfig.app.json` の `include` を確認する。
