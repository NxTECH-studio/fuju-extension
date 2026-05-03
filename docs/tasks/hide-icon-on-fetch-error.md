# API fetch エラー時に Fuju アイコンを専用エラー SVG に差し替える

## 概要

X.com 上の Fuju ユーザー判定 API (`/v1/users/lookup`) が失敗した際に、現状「マゼンタのローディング SVG が opacity 0.3 で残る」だけになっている見た目を、**エラー専用 SVG（デフォルト案: グレーの感嘆符マーク）に差し替えて opacity 0.3 で薄く表示する**よう変更する。再試行は行わず、`pendingRequests` の in-flight 共有以上のガードは入れない。

> ブランチ前提: 本タスクは PR #4 (`feat/integrate-fuju-auth`) のマージ後に **`develop` から新ブランチ `fix/hide-icon-on-fetch-error` を切る**。`fujuData()` の戻り値型 (`Promise<{ exists: boolean } | null>`) と `/v1/users/lookup` への切り替えは PR #4 で取り込まれている前提で計画している。

## 背景・目的

### 現状の問題

`src/content/x/userData.ts` の `insertIcon()` / `insertFujuIcon()` を読み直した結果、ユーザーが「アイコンが表示されない／壊れている」と認識している現象の原因は **複合的** であることが分かった。

1. **そもそも `createLoadingIcon()` 以外の SVG が実装されていない**
   - `src/content/img/loadingIcon.ts` には「マゼンタ (`#FF00FF`) の星型 SVG」しかなく、`insertFujuIcon()` で結果を反映する際にも **同じ SVG のまま `opacity` だけが書き換えられる**。
   - 成功時 (`result.exists === true`) は `opacity: 1`、未登録 (`result.exists === false`) と API 失敗 (`result === null`) は `opacity: 0.3`。3 状態とも見た目がほぼ同じで、「ロード中」「Fuju ユーザー」「未登録」「エラー」が判別不能。
2. **エラー時の `dataset.fujuUserId = 'null'` という意味替えが未文書化**
   - `insertFujuIcon()` で `result === null` のとき `dataset.fujuUserId = 'null'` がセットされるが、`getFujuIcon()` の判定は `dataset.inserted === 'true'` だけを見るため、**次回の MutationObserver イベントでも「処理済み」として再試行されない**。一度失敗したアイコンは永続的に薄いローディング SVG のまま残る。本タスクでは「再試行しない」方針を採るため、この挙動自体は維持するが、**見た目をエラー専用 SVG に差し替える** ことでユーザーに状態を明示する。
3. **挿入位置の二重計算リスク**
   - `insertIcon()` (L80-85) と `insertFujuIcon()` (L25-29) の両方で `username.insertBefore(fujuIcon, username.children[1])` を実行しうる。通常は `insertIcon()` が先に挿入するため `getFujuIcon()` が拾うが、X 側の DOM が再構成された場合に重複挿入の可能性がある。本タスクで `insertFujuIcon()` 側のフォールバックを削除する。
4. **`fujuData()` 自体は throw しない**
   - `src/content/api/fujuUserCache.ts` の `fujuData()` は try/catch で例外を握り潰し `null` を return する。よって `insertIcon()` の `await fujuData(userId)` 後の `insertFujuIcon()` は **必ず呼ばれる**。
   - `pendingRequests` (L11) で同一ユーザーの in-flight リクエストは共有されるため、本タスクで「再試行しない」方針を採っても、MutationObserver の連続発火で同じ tweet に対して fetch が多重発行されることはない。

### このタスクで解決したいこと

- API が失敗したとき、ユーザーから見て **「ローディングが終わった／Fuju ユーザーではなかった／エラーだった」が一目で判別できる** 状態にする。
- **採用方針（ヒアリング Q1 = B）**: 失敗時はローディングアイコンを **エラー専用 SVG に差し替えて opacity 0.3 で表示**する。再試行はしない（一度失敗したらそのまま）。
- 副次的に、`insertFujuIcon()` 内の重複挿入フォールバックを削除して挿入経路を `insertIcon()` 側に一本化する。

### 検討した代替案

- **A 案（DOM 削除）**: API 失敗時はローディングアイコンを `fujuIcon.remove()` で DOM から削除し、次回 MutationObserver サイクルで自動再試行させる。見た目はクリーンだが、AuthCore 停止時にスクロール毎に fetch が走り続けるためサーバ・ネットワーク負荷が上がる。
- **C 案（自動再試行 + ローディング SVG 維持）**: `dataset.errorRetryAt` を立てて MutationObserver サイクル毎に削除→再挿入。ユーザー視点では何が起きているか分からないまま fetch が走り続けるため不採用。

> 本タスクでは **B 案** を採用する。エラー状態が永続的に視認できるため、ユーザーが「AuthCore が落ちている」ことに気づきやすい。

## 影響範囲

破壊的変更なし。content script 内部の挙動変更のみで、既存の API 契約 (`fujuData()` の戻り値型、`AUTHCORE_BASE_URL` の利用先) には触らない。

### 新規ファイル

- `src/content/img/errorIcon.ts`
  - `loadingIcon.ts` と同じスタイルで `createErrorSVG()` / `createErrorIcon()` を export する。
  - デフォルトデザイン案: **グレー (`#888888`) の感嘆符 (!) マーク**を 16x16 viewBox の SVG として実装。`createErrorIcon()` は `<div>` ラッパー（1em x 1em、flex 中央寄せ、margin-left 0.25em）で SVG を包んだ要素を返す。

### 既存ファイルの変更

- `src/content/x/userData.ts`
  - 先頭の import に `createErrorIcon` を追加。
  - `insertFujuIcon()` の `result === null` 分岐で、既存の `<div>` ラッパー内の子要素（ローディング SVG）を **エラー SVG に差し替える**。具体的には `fujuIcon.replaceChildren(createErrorSVG())` のような形で SVG 要素のみ入れ替え、ラッパーの位置・サイズは維持する。`opacity: 0.3` を適用。
  - `setFujuIconLoading()` のローディング状態解除箇所（`insertFujuIcon()` 内 L32 付近）の dataset を整理:
    - `dataset.loading = 'false'` を維持。
    - エラー時は `dataset.fujuUserId = 'error'`（旧来の `'null'` 文字列より意図が明確）に変更。
  - `insertFujuIcon()` 内の重複挿入フォールバック (L25-29) を削除。`getFujuIcon()` が null のときは何もせず return する（呼び出し側の `insertIcon()` が必ず先にローディングアイコンを挿入してから呼ぶ前提）。
- `src/content/api/fujuUserCache.ts`
  - 変更なし。`pendingRequests` の in-flight 共有で MutationObserver の連続発火による多重 fetch は防がれているため、追加ガードは不要。
- `src/content/img/loadingIcon.ts`
  - 変更なし。

### ユーザーに事前確認したい軽い質問（実装着手前に微調整可）

エラー専用 SVG のデザインについて、好みを教えてください。下記いずれでも実装ステップは同じで、`createErrorSVG()` の `path` 定義のみ差し替えます。**回答がなくてもデフォルト案（1）で進めます**。

1. **【デフォルト】グレーの感嘆符 (!)** — 一般的なエラー記号で意味が伝わりやすい。
2. **グレーの ? マーク** — 「結果不明」のニュアンスを強調。
3. **ローディングアイコンと同じ星型 SVG をモノトーン (`#888888`) 化** — Fuju ブランド感を維持しつつエラー状態を示す。
4. **その他（指定があれば SVG パスを別途共有）**

## 実装ステップ

PR #4 マージ後、`develop` から新ブランチを切る:

```sh
git fetch origin
git switch develop
git pull
git switch -c fix/hide-icon-on-fetch-error
```

1. **現状再現の確認**
   - `npm run dev` で拡張をロードし、`AUTHCORE_BASE_URL` を意図的に存在しないホスト（例: `http://127.0.0.1:1`）に向けて X.com を開く。
   - DevTools の Elements パネルで `[data-testid="User-Name"]` の子に `<div data-inserted="true" data-loading="true" data-fuju-user-id="null">` が残ることを確認。これが「差し替え対象の状態」。
2. **`src/content/img/errorIcon.ts` の新規作成**
   - `loadingIcon.ts` と同じ構造で `createErrorSVG(): SVGSVGElement` と `createErrorIcon(): HTMLDivElement` を実装。
   - デフォルト案: 16x16 viewBox 上にグレー (`#888888`) の感嘆符 (!) を `<path>` で描画。感嘆符の縦棒と下のドットを 2 つの `<rect>` または単一の `<path>` で表現。
   - `createErrorIcon()` のラッパー `<div>` のスタイルは `loadingIcon.ts` の `createLoadingIcon()` と同一にする（`height: 1em; width: 1em; display: flex; align-items: center; justify-content: center; margin-left: 0.25em;`）。サイズと配置を揃えることで差し替え時のレイアウトシフトを防ぐ。
3. **`src/content/x/userData.ts` の修正**
   - import 追加:
     ```ts
     import { createErrorIcon } from '../img/errorIcon';
     ```
     （または `createErrorSVG` を export して個別 import）
   - `insertFujuIcon()` 内の重複挿入フォールバック (L25-29) を削除。`getFujuIcon()` が null を返したら早期 return。
   - `insertFujuIcon()` の `result === null` 分岐をエラーアイコン差し替えに変更:
     ```ts
     if (result === null) {
       // API 失敗: SVG をエラー用に差し替え、薄く表示
       const errorIcon = createErrorIcon();
       fujuIcon.replaceChildren(...errorIcon.childNodes);
       fujuIcon.dataset.loading = 'false';
       fujuIcon.dataset.fujuUserId = 'error';
       fujuIcon.style.opacity = '0.3';
       return;
     }
     ```
   - 既存の成功 / 未登録分岐 (L41-44) は変更なし。
4. **`getFujuIcon()` / `insertIcon()` 側の整合性確認**
   - エラー後は `dataset.inserted === 'true'` かつ `dataset.loading === 'false'` のままなので、`insertIcon()` 冒頭の早期 return ガード (L54-59) でスキップされる。**再試行されない** ことを確認する。
   - `pendingRequests` (`fujuUserCache.ts` L11) は finally で削除されるため、別の tweet で同じ userId が出てきた場合は通常通り fetch が走り、成功すればキャッシュに乗る。エラー後の再描画はページリロード時のみ。
5. **手動テスト**
   - ケース 1: AuthCore が起動済みで Fuju 登録済みユーザーをタイムラインに表示 → 不透明度 1 のマゼンタ星型アイコンが残る。
   - ケース 2: AuthCore が起動済みで未登録ユーザーを表示 → opacity 0.3 の薄いマゼンタ星型アイコンが残る。
   - ケース 3: `AUTHCORE_BASE_URL` を `http://127.0.0.1:1` に向けてタイムラインを表示 → opacity 0.3 の **グレー感嘆符アイコン** が残る。スクロールで新しい tweet が出ても再試行されないことを確認。
   - ケース 4: ケース 3 の状態から AuthCore を起動して同じページをリロード → 各ユーザーに対し再 fetch が走り、ケース 1/2 の表示になる。
6. **lint / format / typecheck**
   - `npm run lint`、`npm run format`、`npm run typecheck` を通す。
7. **PR 作成**
   - ベースブランチ: `develop`
   - タイトル: `fix(content): show error icon on fuju lookup failure`
   - 本文に「Before / After」のスクリーンショット（特にケース 3）を貼る。

## テスト要件

- **挙動確認** (上記実装ステップ 5 参照): API 成功・未登録・失敗の 3 ケース + 失敗→リロード→成功のケースで DOM 状態と見た目が期待通りであること。
- **自動テスト**: 既存リポジトリに jest/vitest 等のテスト基盤がない場合は手動テストのみで OK（必要なら `vitest` 導入の別タスクを切る）。
- **回帰確認**: 同一ユーザー名が複数のツイートに出るケースで、すべてに同じ判定（成功なら星型、失敗なら感嘆符）が反映されること（`fujuUserCache` のキャッシュ / `pendingRequests` の共有が効いていること）。
- **レイアウトシフト確認**: ローディング SVG → エラー SVG への差し替え時に username 行の高さが変わらないこと（`createErrorIcon()` のラッパー `<div>` のサイズを `createLoadingIcon()` と揃えているため、原則発生しないはず）。

## 技術的な補足

- `fujuIcon.replaceChildren(...errorIcon.childNodes)` で SVG だけ入れ替え、ラッパー `<div>` 自体（および `dataset.inserted` 等の属性）は再利用する。`fujuIcon.replaceWith(errorIcon)` だと dataset を作り直す必要があるためやや面倒。
- 「再試行なし」方針のため、`pendingRequests` 以上のガードは不要。`insertIcon()` 冒頭の `existingIcon?.dataset.loading !== 'true'` ガードでエラー後の再エントリは自然にブロックされる。
- `dataset.fujuUserId = 'error'` は旧来の `'null'` 文字列から変更。既存のコードベースで `dataset.fujuUserId` 値を参照する箇所は無い（Grep 確認推奨）が、もし参照箇所があれば追従する。
- `username.children.length < 2` ガード (`insertIcon()` L48) は X.com の DOM 構造に依存しており、本タスクのスコープ外だが「アイコンが挿入されない」もう一つの原因となりうる。`children[1]` が無い場合に末尾追加へフォールバックさせるリファクタは別タスクで検討。
- `MutationObserver` の `attributes: true` は本来不要 (`childList` だけで足りる)。本タスクでは触らないが、別タスクでパフォーマンス改善として外せる。
