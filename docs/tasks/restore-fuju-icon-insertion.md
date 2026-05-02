# X タイムライン上に Fuju アイコンが一切表示されない不具合の修正

## 概要

ブランチ `fix/hide-icon-on-fetch-error` 上で動作確認したところ、X.com を開いても Fuju アイコンが一切挿入されず、**`processTweetElement` 内の `console.log(usernames != null)` も `insertIcon()` 内の `console.log("ユーザー: ...")` も両方とも DevTools Console に出力されない** 状態になっている。`processTweetElement` がそもそも一度も呼ばれていない＝ `insertIcon()` の早期 return ガード以前のレイヤー（content script のロード、エントリポイント、observer 起動、selector マッチ等）に問題がある。本タスクでは原因レイヤーを 4 つの仮説に整理し、ユーザーへの追加質問（質問3）の回答と実機検証で原因を特定し、該当レイヤーを修正する。

> **本タスク着手前にユーザーから追加情報（質問3）を取得する必要あり**。回答内容によって修正範囲（仮説 1〜4）のうちどれを採用するかを確定する。

## 背景・目的

### 既知の状態（質問2(a) の回答より確定）

- DevTools Console に **どのログも出ていない**:
  - `processTweetElement` 内 (`src/content/x/userData.ts` L94) の `console.log(usernames != null)` → 出ない
  - `insertIcon()` 内 (`src/content/x/userData.ts` L88) の `console.log("ユーザー: ...")` → 出ない
- よって **`processTweetElement` 自体が一度も呼ばれていない** ことが確定。
- `insertIcon()` の L47 ガード (`username.children.length < 2`) は本件の原因ではなく、もっと上流で処理が止まっている。

### コード調査で確認した事実

`src/content/index.ts`、`src/content/x/index.ts`、`src/content/x/userData.ts`、`public/manifest.json`、`dist/content.js` を読み直し、以下を確認:

1. **`src/content/index.ts`** L1-15:
   ```ts
   import x from './x';
   console.log('[content] loaded on', location.href);
   const parse = location.href.split('/');
   const page = parse[2];
   switch (page) {
     case 'x.com':
     case 'twitter.com':
       x();
       break;
     default:
       console.log('NOT SUPPORTED');
   }
   ```
   - **L3** で `[content] loaded on ...` を出力する。**このログが出るかどうかが「content script がロードされたか」の最重要シグナル**。
   - `parse[2]` は `https://x.com/home` の場合 `x.com`、`https://x.com/i/grok` でも `x.com`。`x.com` / `twitter.com` 以外は `NOT SUPPORTED` を出す。
2. **`src/content/x/index.ts`** L3-53:
   - エクスポート関数 `x()` は次を行う:
     - 初回 `getTweetElements()` 実行（`document.querySelectorAll('[data-testId="tweet"]')`）
     - `MutationObserver` を `document.body` に対して `{ childList: true, subtree: true, attributes: true }` で起動
     - 起動成功時に `console.log("ツイート要素の監視を開始しました")` を出力
     - 各 mutation で `console.log("DOM変更を検出しました")` を出力
   - **L6 の selector は `[data-testId="tweet"]`（testId 大文字 I）**。HTML5 仕様では属性名はパース時に小文字化されるので `[data-testid="tweet"]` と等価に動作することが多いが、**ブラウザ実装や大小文字区別フラグ次第で 0 件返すリスクがある**（後述、仮説 2-b）。
3. **`public/manifest.json`** L15-21:
   ```json
   "content_scripts": [
     {
       "matches": ["<all_urls>"],
       "js": ["content.js"],
       "run_at": "document_idle"
     }
   ]
   ```
   - `matches: ["<all_urls>"]` で **全 URL に注入**される。`x.com` / `twitter.com` で content script がロードされないということは manifest 起因では起きない。**仮説 1（manifest 不整合）はほぼ否定される。** ただし「拡張をリロードしていない」「ビルド成果物が古い」場合は別問題として残る。
   - `run_at: document_idle` のため、X.com の SPA が初回レンダリング前後にロードされる。
4. **`dist/content.js`** を確認した結果、最新ソースの全ログ文字列（`[content] loaded on`, `ツイート数:`, `ツイート要素の監視を開始しました`, `usernames != null`, `ユーザー: ${i}, fuju exists`, `NOT SUPPORTED`, `DOM変更を検出しました`）が **すべて含まれている**。
   - つまり `dist/content.js` 自体は最新であり、**ビルド漏れではない可能性が高い**（ただし最後にビルドした時刻と Chrome に読まれているファイルの一致は実機で確認が必要・質問3-1）。

### 仮説リスト（原因レイヤー別）

| # | レイヤー | 仮説 | 検証方法 |
|---|---|---|---|
| 1 | 拡張ロード | `dist/content.js` が古い、または Chrome が古いバージョンをキャッシュしている。`npm run build` 後に拡張をリロードしていない | 質問3-1, 3-2 |
| 2-a | content script 注入 | `manifest.json` の `matches` は `<all_urls>` だが、Chrome 側でブロック / エラーが発生している（CSP, 拡張権限拒否等） | 質問3-2, 3-5 |
| 2-b | selector マッチ | `src/content/x/index.ts` L6 の `[data-testId="tweet"]`（大文字 I）が現代の X.com DOM とマッチせず、初回 `getTweetElements()` が 0 件を返す。だが `console.log("ツイート数: ${elems.length}")` (L7) は **0 件でも実行される** はずなので、**このログすら出ないなら別レイヤー** | Console で `ツイート数:` のログが出るか確認（質問3-3） |
| 3 | `x()` 未呼出 | `src/content/index.ts` の page 判定で `x.com` / `twitter.com` 以外と判定され、`NOT SUPPORTED` 分岐に落ちている。例: `location.href` が `chrome-extension://...` で `parse[2]` が拡張 ID になる、あるいは iframe 内で `about:blank` になる | Console で `[content] loaded on ...` および `NOT SUPPORTED` のログが出るか確認（質問3-3） |
| 4 | observer 起動失敗 | `document.body` が L37 時点で `null` で、`DOMContentLoaded` 待ちになっているが、`run_at: document_idle` のため通常は body が存在し、ここに落ちることは稀 | Console で `ツイート要素の監視を開始しました` のログが出るか確認（質問3-3） |

> **最有力候補は仮説 1（拡張のリロード忘れ／ビルド古い）と仮説 2-a（CSP / エラーで content script が落ちている）**。仮説 3 は `https://x.com/...` を開いていれば原理上発生しないが、`twitter.com` のままだと `parse[2] === "twitter.com"` で OK のはずなので、URL の確認が必要（質問3-4）。

## 事前確認したい情報（ユーザーへの質問3）

実機で以下を確認してください:

### 3-1. ビルド & 拡張リロードの確認

- `npm run build` を実行してから `chrome://extensions` で fuju-extension の **リロードボタン**（ぐるっと矢印アイコン）を押してから X.com を開いていますか？
- それとも `npm run dev` での watch ビルドで、ファイル変更後に拡張リロードを実施していますか？
- `dist/content.js` のタイムスタンプ（Explorer や `Get-Item dist/content.js | Select LastWriteTime`）は最新ですか？

### 3-2. 拡張機能のエラーログ

- `chrome://extensions` で fuju-extension を見ると、**「エラー」ボタン** または **赤いバッジ** が表示されていますか？
- 表示されている場合、その内容（content.js のロード失敗、構文エラー、CSP 違反など）を貼ってください。

### 3-3. DevTools Console のフィルタ確認

X.com を開いた状態で DevTools Console を開き、以下を確認してください:

- 上部の **「Top」フィルタを **「fuju-extension」** または **content script 名のドロップダウン** に切り替え** ても、何のログも出ませんか？
  - **content script のログは isolated world に出るので、`Top` フィルタのままでは出ない場合があります。** Console 上部の左上にある **コンテキスト切替プルダウン** を「Top」から拡張機能名に変更してください。
- `[content] loaded on https://x.com/...` のログは出ますか？
  - **出る** → content script はロード済み。`x()` 内で詰まっている（仮説 2-b, 4 へ）
  - **出ない** → content script 自体がロードされていない（仮説 1, 2-a へ）
- `ツイート要素の監視を開始しました` のログは出ますか？
  - **出る** → observer 起動済み。selector か DOM 構造側の問題（仮説 2-b へ）
  - **出ない** → `x()` の中で `document.body` 取得前に落ちているか、そもそも `x()` が呼ばれていない（仮説 3, 4 へ）
- `ツイート数: <N>` のログは出ますか？
  - **出る (N == 0)** → selector mismatch（仮説 2-b 確定）
  - **出る (N >= 1)** → `processTweetElement` まで到達しているはず → そもそもの前提が崩れる（再ヒアリング）
  - **出ない** → observer 起動より前で落ちている

### 3-4. 開いている URL

- X.com の URL は `https://x.com/...` ですか、それとも `https://twitter.com/...` ですか？
- `https://mobile.x.com/...` や `https://pro.x.com/...` のようなサブドメインではないですか？（`parse[2]` がサブドメイン込みになり判定漏れする可能性）

### 3-5. その他のエラー

DevTools Console に **何らかのエラー**（赤色のメッセージ）は出ていませんか？ 特に以下:

- `Refused to execute inline script because it violates the following Content Security Policy directive` (CSP 違反)
- `Failed to load resource: net::ERR_FILE_NOT_FOUND` （content.js のパス間違い）
- `Uncaught SyntaxError` / `Uncaught ReferenceError` （ビルドエラー混入）
- `chrome.runtime is undefined` 系

## 影響範囲

仮説確定後、修正対象は以下のいずれか（または複数）:

- **仮説 1 / 3-1 確定時**: 修正コード変更なし。`npm run build` → 拡張リロード手順を README / 開発ドキュメントに明記。
- **仮説 2-a 確定時**: `public/manifest.json` の `content_scripts.matches` を `["https://x.com/*", "https://*.x.com/*", "https://twitter.com/*", "https://*.twitter.com/*"]` に絞る（`<all_urls>` で問題が起きる場合の対処）。CSP の問題なら `host_permissions` の見直し。
- **仮説 2-b 確定時**: `src/content/x/index.ts` L6 の selector を `[data-testid="tweet"]`（小文字）に統一し、加えて他の現代 X.com DOM への追従（`article[data-testid="tweet"]`, `[role="article"]` など）を検討。
- **仮説 3 確定時**: `src/content/index.ts` の page 判定を `host.endsWith('x.com') || host.endsWith('twitter.com')` 形式に変更し、サブドメイン込みでもマッチさせる。
- **仮説 4 確定時**: `src/content/x/index.ts` L37-46 の body 取得ロジックを `document.readyState` チェックに変更、または `run_at: document_start` にして observer 起動を保証。

破壊的変更なし（API 契約・データ構造の変更なし）。

### 触る可能性があるファイル

- `public/manifest.json`（仮説 2-a）
- `src/content/index.ts`（仮説 3）
- `src/content/x/index.ts`（仮説 2-b, 4）

### 触らないファイル

- `src/content/x/userData.ts`（`processTweetElement` まで到達できれば、内部の早期 return は別タスク `restore-fuju-icon-insertion` 第二弾で扱う想定。本タスクは「呼ばれない」問題を解く）
- `src/content/api/fujuUserCache.ts`
- `src/content/img/loadingIcon.ts`
- `src/shared/config.ts` / `.env`

## 修正方針（質問3 の回答後に確定）

### 方針 1（仮説 1 確定時）: ビルド & リロード手順の周知のみ

コード変更なし。以下を `README.md`（または `CONTRIBUTING.md`）に追記:

```md
## ローカルでの動作確認

1. `npm run build` で `dist/` を生成
2. `chrome://extensions` を開き、fuju-extension の「リロード」ボタンを押す
3. X.com のタブをリロード
4. DevTools Console で `[content] loaded on https://x.com/...` が出ることを確認
```

`npm run dev` を使う場合も「ビルド差分発生後は必ず拡張リロード」を明記。

### 方針 2-a（仮説 2-a 確定時）: manifest の matches を明示的に絞る

`public/manifest.json` を以下に変更:

```jsonc
"content_scripts": [
  {
    "matches": [
      "https://x.com/*",
      "https://*.x.com/*",
      "https://twitter.com/*",
      "https://*.twitter.com/*"
    ],
    "js": ["content.js"],
    "run_at": "document_idle"
  }
]
```

`<all_urls>` で発生していた CSP / 権限トラブルが解消する想定。`host_permissions` 側は既に `https://x.com/*`, `https://*.x.com/*` が含まれているので追加で `twitter.com` 系も追加検討。

### 方針 2-b（仮説 2-b 確定時）: selector を小文字に統一

`src/content/x/index.ts` L6 を変更:

```ts
// 変更前
const elems = document.querySelectorAll('[data-testId="tweet"]');

// 変更後
const elems = document.querySelectorAll('[data-testid="tweet"]');
```

ついでに、X.com の現代 DOM では tweet 要素が `<article role="article" data-testid="tweet">` の形を取るため、`article[data-testid="tweet"]` でより明示的にする選択肢もある。

### 方針 3（仮説 3 確定時）: host 判定をサブドメイン許容に

`src/content/index.ts` を変更:

```ts
// 変更前
const parse = location.href.split('/');
const page = parse[2];
switch (page) {
  case 'x.com':
  case 'twitter.com':
    x();
    break;
  default:
    console.log('NOT SUPPORTED');
}

// 変更後
const host = location.host; // 例: "x.com", "mobile.x.com"
if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
  x();
} else {
  console.log('NOT SUPPORTED', host);
}
```

`location.host` を使うことで `:port` が付くケースも考慮しやすく、サブドメインも `endsWith` で許容できる。

### 方針 4（仮説 4 確定時）: body 取得ロジックを堅牢化

`src/content/x/index.ts` L37-46 を変更:

```ts
// 変更前
if (document.body) {
  observer.observe(document.body, config);
  console.log('ツイート要素の監視を開始しました');
} else {
  globalThis.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, config);
    console.log('ツイート要素の監視を開始しました');
  });
}

// 変更後
const startObserving = () => {
  observer.observe(document.body, config);
  console.log('ツイート要素の監視を開始しました');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving, { once: true });
} else {
  startObserving();
}
```

加えて `manifest.json` の `run_at` を `document_idle` のままで問題なければ維持。

## 実装ステップ

> 質問3 の回答を待ってから、以下のステップに進む。回答内容に応じて方針を確定。

### 1. 原因確定（質問3 回答 + 実機検証）

1. ユーザーから質問3-1〜3-5 の回答を受領。
2. 上記「仮説リスト」の表に従って原因レイヤーを特定:
   - 3-3 で `[content] loaded on ...` が出るか出ないかが最重要分岐点。
3. 必要に応じて以下のコマンドで補足調査:
   ```sh
   git log --oneline -- src/content/index.ts src/content/x/index.ts public/manifest.json
   git log -1 --format='%ci %h %s' -- public/manifest.json
   git log -1 --format='%ci %h %s' -- src/content/x/index.ts
   ls -la dist/content.js  # PowerShell では: Get-Item dist/content.js | Select LastWriteTime
   ```

### 2. 該当方針の修正適用

確定した方針（1 / 2-a / 2-b / 3 / 4）に従って該当ファイルを変更。複数仮説が同時に確定した場合は **すべて適用**（方針 2-b と方針 3 は競合しない）。

### 3. ビルド & 動作確認

```sh
npm run build
```

`chrome://extensions` で拡張をリロードし、X.com のタブをリロード。

DevTools Console で以下のログが順番に出ることを確認:

1. `[content] loaded on https://x.com/...`
2. `ツイート要素の監視を開始しました`
3. `ツイート数: <N>` (`N >= 1`)
4. `true` (`processTweetElement` の `usernames != null`)
5. `ユーザー: <id>, fuju exists: false`（または `true` / `unknown`）

**最低限 1〜4 が出れば、本タスクの目的は達成**。ステップ 5（`ユーザー:` ログ）が出ない場合は別タスク `restore-fuju-icon-insertion` 第二弾（`insertIcon()` の早期 return 修正）に引き継ぐ。

### 4. lint / format / typecheck

```sh
npm run lint
npm run format
npm run typecheck
```

### 5. PR 作成

- ブランチ: `fix/restore-content-script-loading`（`develop` から切る。**現ブランチ `fix/hide-icon-on-fetch-error` とは独立**にし、本修正を先に出す）
- ベース: `develop`
- タイトル: 確定した仮説に応じて以下のいずれか:
  - 方針 1: `docs: clarify build & reload workflow for chrome extension`
  - 方針 2-a: `fix(manifest): scope content_scripts to x.com / twitter.com`
  - 方針 2-b: `fix(content/x): use lowercase data-testid selector for tweets`
  - 方針 3: `fix(content): match x.com / twitter.com subdomains for host check`
  - 方針 4: `fix(content/x): start MutationObserver on DOMContentLoaded`
- 本文: 原因（質問3 で確定したログ欠落の根本理由）と Before / After のスクリーンショットを添付。

## テスト要件

### 必須（手動確認）

- `https://x.com/home` を開いた直後の DevTools Console に以下のログ全てが出ること:
  - `[content] loaded on https://x.com/home`
  - `ツイート要素の監視を開始しました`
  - `ツイート数: <N>` (`N >= 1`)
  - `true`（`processTweetElement` 内）
- スクロールして新しい tweet が表示された際に、新しい `ツイート数:` および `true` ログが追加で出力されること（observer 動作確認）。

### 望ましい（時間があれば）

- `https://twitter.com/home` でも同じログが出ること。
- DevTools の **Network パネル** で `/v1/users/lookup?provider=x&q=...` のリクエストが飛んでいること（処理が API レイヤーまで到達した証拠）。
- `chrome://extensions` のエラーログが空であること。

### スコープ外（別タスク）

- アイコンが実際に DOM に挿入されること → 別タスク（`restore-fuju-icon-insertion` 第二弾を起こす）。本タスクは「`processTweetElement` が呼ばれる」までを担保する。
- API 失敗時のエラー SVG 差し替え → `docs/tasks/hide-icon-on-fetch-error.md` で別途進行中。

## 技術的な補足

- **content script の isolated world**: Chrome の content script は X.com のページコンテキストとは別の isolated world で実行され、`console.log` の出力も DevTools Console の上部「Top」コンテキストではなく **拡張機能名のコンテキスト** に出ることがある。Console 上部のドロップダウンで切り替えが必要。質問3-3 はこれの確認も兼ねている。
- **HTML5 属性名の小文字化**: `[data-testId="tweet"]` のように大文字を含む属性セレクタは、HTML（XHTML ではない）では属性名がパース時に小文字化されるため、ブラウザは `[data-testid="tweet"]` と等価に扱う。**実害が出ているケースは少ないが、可読性と一貫性のために小文字に統一すべき**。
- **`run_at: document_idle`**: SPA である X.com では、idle 時点でも tweet 要素はまだロードされていないことが多い。MutationObserver で後追いするのが正解で、現コードはこの構造になっている。
- **本タスクと `hide-icon-on-fetch-error` の関係**: 本タスクで「`processTweetElement` が呼ばれる」状態に戻ったあと、`insertIcon()` の早期 return ガード（`username.children.length < 2`）の問題が顕在化する可能性がある。その場合は `restore-fuju-icon-insertion` 第二弾を起票し、`insertBefore(node, children[1] ?? null)` パターンへの修正を検討する。`hide-icon-on-fetch-error` のエラー SVG 差し替えは、本タスクと「第二弾」の両方が完了して初めて視認可能になる。
- **ブランチ戦略**: 本タスクは `fix/hide-icon-on-fetch-error` よりも先に `develop` にマージすべき。さもなければ、エラー SVG 差し替えの動作確認自体が不可能（そもそも content script がロードされていなければアイコン挿入経路全体が動かない）。
