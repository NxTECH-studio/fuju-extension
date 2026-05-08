# YouTube subscribe ボタン横に「ふじゅ〜」ボタンを追加

## 概要

YouTube の `/watch` ページのチャンネル行と、`/@handle` / `/channel/UC…` のチャンネルヘッダにある subscribe ボタン（`ytd-subscribe-button-renderer` 内の `yt-button-shape#subscribe-button-shape`）の **直後** に、**Fuju 拡張ユーザーが認証済み (`isAuthenticated === true`) かつ 現在見ているチャンネルが Fuju 登録済み (`fujuData('youtube', q).exists === true`) の AND 条件** を満たすときだけ「ふじゅ〜」と表示する独自ボタンを挿入する。クリックハンドラはスタブ (`console.log` のみ) とし、本タスクでは UI 設置と表示制御 (auth state + lookup 結果の連動 / SPA 遷移追従 / 重複挿入防止) のみを完成させる。

## 背景・目的

- 前 PR `#14 (feat(content/youtube): 閲覧中チャンネルの検出と Fuju lookup 接続)` が develop に merge 済みで、`extractCurrentChannel()` / `onChannelContextChange()` / `fujuData('youtube', q)` までのデータレイヤが揃っている (`docs/tasks/detect-current-youtube-channel.md`)。
- 一方で UI 側の作業は意図的にスコープ外として残されており、`detect-current-youtube-channel.md` 末尾の「今後の関連タスク」 1. アイコン UI 表示 にも次タスクとして明記されている。
- エンジニアの要望: 「チャンネル登録ボタンの横に、認証済みユーザーであれば『ふじゅ〜』っていう名前のボタンを付けてほしい」。
  - DOM サンプル提供あり: `ytSmartImationsContent` ルート / `yt-button-shape#subscribe-button-shape` / `ytd-subscribe-button-renderer` / `notification-preference-toggle-button` / 登録済み時 "登録済み" / `yt-animated-action`。
- 本タスクで「subscribe ボタン横に Fuju ボタンを置く」UI 接地ができれば、後続の YouTube 投げ銭フローの起点 (entry point) として再利用できる。
- アイコン挿入 (`createRegisteredIcon` 等) は X 用に作られた装飾アイコンで、subscribe 行に置く「クリック可能なボタン」とは性質が違うため、本タスクでは流用せず、subscribe ボタンの見た目に揃えた独自ボタンを新設する。

### 確定済みの前提

エンジニアとの対話で以下を確定:

- **(A) 表示条件:** **Fuju 拡張に Fuju 自身としてログイン済み (`isAuthenticated === true`) かつ 現在見ているチャンネルが Fuju 登録済み (`fujuData('youtube', q).exists === true`) の AND 条件** を満たすときだけ表示する。どちらか一方でも欠ければ非表示。
- **(B) ボタンの目的・遷移先:** 将来の YouTube 投げ銭フローの起点となる UI を想定。本タスクでは onClick は `console.log('[fuju/youtube] fuju button clicked', { provider: 'youtube', q })` のスタブのみ。実機能は別タスク。
- **(C) 表示対象ページ:** subscribe ボタンが描画される `/watch` のメタデータ行 と `/@handle` / `/channel/UC…` のチャンネルヘッダ。**Shorts は別タスク** (subscribe ボタンが overlay UI で出る構造が異なるため)。
- **(D) 共同投稿 (collab) の secondary 行:** subscribe host が複数見つかった場合は **すべて** に挿入する (collab の secondary channel にもボタンを出す)。挿入条件は各 host の `q` ごとに lookup → `exists === true` を満たすかで判定する。

## 影響範囲

### 既存ファイルの変更

- `src/content/youtube/index.ts`
  - 既存の lookup 導線に **「Fuju ボタン挿入」** の責務を追加する。
  - SPA 遷移時 / DOM hydration 時の MutationObserver から、ボタン挿入処理を呼び出す。
  - background から auth state を取得し、その変化を `chrome.storage.onChanged` で受信して再評価する。

### 新規追加

- `src/content/youtube/fujuButton.ts`
  - subscribe ボタン横への DOM 挿入ロジックを集約。export:
    - `ensureFujuButton(opts: { shouldShow: boolean; q: string | null }): void`
      - `shouldShow === true` (= auth AND lookup.exists) かつ subscribe ボタンが見つかれば挿入、`shouldShow === false` なら既存ボタンを除去、すでに正しく挿入されていれば no-op。
    - `removeAllFujuButtons(): void` (auth state または lookup 結果で表示条件が満たされなくなったときの掃除用)。
  - 内部実装:
    - `findSubscribeButtonHosts(): HTMLElement[]` — `ytd-subscribe-button-renderer` をルートに `yt-button-shape#subscribe-button-shape` を 1 つ以上探す (`/watch` のメタデータ行と チャンネルヘッダ両方を拾うため `document.querySelectorAll('ytd-subscribe-button-renderer')` ベース)。
    - `createFujuButton(): HTMLElement` — subscribe ボタンの styling に近い見た目で「ふじゅ〜」ラベル付きの `<button>` を生成。
    - `getInsertedFujuButton(host: HTMLElement): HTMLElement | null` — `dataset.fujuButton === 'true'` でマーカー判定。
- `src/content/youtube/authState.ts`
  - content script 専用の auth state 取得・監視ユーティリティ。export:
    - `getAuthState(): Promise<{ isAuthenticated: boolean }>` — `chrome.runtime.sendMessage({ type: AuthMessageType.GET_STATE })` を thin wrap。失敗時は `{ isAuthenticated: false }`。
    - `onAuthStateChange(handler: (state) => void): () => void` — `chrome.storage.onChanged` で `STORAGE_KEYS.accessToken` / `STORAGE_KEYS.user` を監視して再取得 → `handler` を呼ぶ。`AuthProvider.tsx` と同じ監視ロジックを content script 側に移植する。
- (参考) スタイル: 別 CSS ファイルは作らず、`createFujuButton` 内で `style.cssText` または個別 `style.*` でインライン指定する (X 側 `createRegisteredIcon` の方針に揃える / content script 注入時の CSS 衝突回避)。

### 変更しないもの (このタスクのスコープ外)

- `src/content/shared/img/*` の既存アイコン (登録済み / 未登録 / ローディング) の流用は **しない**。subscribe 行のクリッカブルボタンとは性質が異なるため。
- `manifest.json` の `content_scripts` / `host_permissions` (既存設定で OK)。
- background / `src/background/*` / `src/shared/auth/*` (既存メッセージ `GET_STATE` をそのまま使う)。
- impression tracker / 投げ銭機能本体 (別タスク)。
- Shorts overlay 上の subscribe ボタン (別タスク)。
- 共同投稿 (collab) の secondary channel 行へのボタン挿入 (別タスク)。

### 破壊的変更

- なし。既存の lookup 導線・X 側の挙動・ AuthCore API への影響なし。

## 実装ステップ

### Phase 1: auth state 取得・監視

1. `src/content/youtube/authState.ts` を新規作成。
   - `getAuthState()`: `chrome.runtime.sendMessage({ type: AuthMessageType.GET_STATE })` を await し、`AuthResponse<GetStateResponseData>` から `isAuthenticated` を取り出す。`chrome.runtime.lastError` があれば `false` を返す。
   - `onAuthStateChange(handler)`: `chrome.storage.onChanged` listener を登録し、`areaName === 'local'` かつ `STORAGE_KEYS.accessToken` または `STORAGE_KEYS.user` が変化したら `getAuthState()` を再呼び出しして `handler` に渡す。戻り値は unregister 関数。
   - `STORAGE_KEYS` は `src/shared/auth/storage.ts` から再利用する (popup 側 `AuthProvider.tsx` と同じパターン)。

### Phase 2: Fuju ボタン UI

2. `src/content/youtube/fujuButton.ts` を新規作成。
3. `createFujuButton()` を実装。要件:
   - `<button type="button" data-fuju-button="true">ふじゅ〜</button>`。
   - subscribe ボタンと **高さが揃う** ように `align-self: center` / `height: 36px` 程度 (M サイズに合わせる)。
   - 初期色は仮の Fuju ブランドカラー `#FF00FF` (X 側のアイコンと同色)。文字色 `#FFFFFF`、`border-radius: 9999px` で pill 形。
   - margin は subscribe ボタンの右隣に置けるよう `margin-left: 8px`。
   - cursor pointer / focus outline / hover の opacity 0.85。インラインスタイルで完結させる (CSS 注入は避ける)。
   - クリック時は `console.log('[fuju/youtube] fuju button clicked', { q })`。`q` は呼び出し側 (`ensureFujuButton`) から captured。
4. `findSubscribeButtonHosts(): HTMLElement[]` を実装。
   - `document.querySelectorAll('ytd-subscribe-button-renderer')` を返す。
   - 各 host の中で `yt-button-shape#subscribe-button-shape` の `.parentElement` (= `ytd-subscribe-button-renderer` の child wrapper) を探し、subscribe ボタンの **直後** (`insertBefore(node, subscribeShape.nextSibling)`) に挿入することを想定。
   - host が `ytSmartImationsContent` 配下の場合 (DOM サンプルの構造) も同じ走査で拾える。
5. `ensureFujuButton({ shouldShow, q })` を実装。
   - `shouldShow === false`: `removeAllFujuButtons()` を呼んで終了。
   - `shouldShow === true`: 各 subscribe host について
     - 既に `data-fuju-button="true"` が挿入済みなら no-op。
     - subscribe ボタン要素 (`yt-button-shape#subscribe-button-shape`) を `host.querySelector` で探す。見つからなければ skip (DOM hydration 中)。
     - `createFujuButton()` を呼び、subscribe ボタンの **直後の sibling** として挿入する (= notification toggle の前。エンジニア確定: 案 A)。
6. `removeAllFujuButtons()` を実装: `document.querySelectorAll('[data-fuju-button="true"]').forEach((el) => el.remove())`。

### Phase 3: content script への結線

7. `src/content/youtube/index.ts` を以下のとおり拡張。
   - エントリ start 時に `getAuthState()` を呼び、`isAuthenticated` を保持する `currentAuth` ローカル変数を持つ。
   - `extractCurrentChannel()` の結果から `pickLookupQ()` で `q` を導出 (既存ロジックを再利用)。
   - 既存の `scan()` / `runLookup()` / MutationObserver の中で、lookup 結果 (`fujuData('youtube', q)`) を取得して **`isAuthenticated && lookup?.exists === true`** を `shouldShow` として `ensureFujuButton({ shouldShow, q })` を呼ぶ。lookup が `null` を返した場合 (未ログイン / ネットワーク失敗) は `shouldShow = false` 扱い。
   - 既存の `onChannelContextChange(onNavigate)` の `onNavigate` で SPA 遷移後にも lookup と `ensureFujuButton` が再評価されるようにする (lastLookupKey reset と同じタイミング)。
   - `onAuthStateChange` を購読し、auth state が変わったら **直前の `q` で lookup 結果を再評価** (またはキャッシュから取得) して `ensureFujuButton` を呼び直す。`isAuthenticated === false` になったときは AND 条件が崩れるので即 `removeAllFujuButtons()` (`ensureFujuButton({ shouldShow: false, q })` で対応)。
   - **共同投稿 (collab) の secondary 行への対応:** `findSubscribeButtonHosts()` が複数 host を返す場合、各 host の channel identifier を `host.querySelector('a[href^="/@"], a[href^="/channel/"]')` から取り出して個別に lookup → `shouldShow` を評価する設計にする。または「メイン q の lookup が exists=true なら全 host に挿入し、collab 個別の登録判定は別タスク」とする簡易設計でも可 (本タスクではエンジニアの確定通り collab にも出すので、簡易設計 = 全 host に挿入 を採用)。
   - teardown で `onAuthStateChange` の unregister と `removeAllFujuButtons()` を呼ぶ。
8. ボタン挿入の **MutationObserver 由来の重複呼び出し** は `dataset.fujuButton === 'true'` マーカーで idempotent に弾く (X 側 `userData.ts` の `dataset.inserted === 'true'` と同じ思想)。

### Phase 4: 動作確認

9. `npm run build` で `dist/content-youtube.js` がビルドできること、TypeScript エラーが出ないこと。
10. `npm run lint` (型チェック含む) を pass。
11. 実機 (chrome://extensions で `dist/` を読み込み) で以下を目視確認:
    - **未ログイン状態**で Fuju 登録済みチャンネルの `/watch?v=…` を開く → 「ふじゅ〜」ボタンが **出ない** (auth=false)。
    - popup から Fuju にログイン → 同じタブで Fuju 登録済みチャンネルの動画を開く → 「ふじゅ〜」ボタンが subscribe ボタンの直後に **出る** (auth=true AND exists=true)。
    - **ログイン状態のまま** Fuju 未登録チャンネルの動画を開く → ボタンが **出ない** (auth=true AND exists=false)。
    - `https://www.youtube.com/@<登録済み handle>` のチャンネルヘッダにも同じ挙動でボタンが出る / 出ない。
    - `https://www.youtube.com/channel/UC…` でも同様。
    - 同一タブで `/@<登録>` → 動画クリック → `/watch?v=<未登録>` → `/@<登録>` の SPA 遷移で、毎回ボタンの表示有無が正しく追従し、二重挿入されない (DOM 上 `[data-fuju-button="true"]` は subscribe host 1 件につき高々 1 つ)。
    - popup からログアウト → ボタンが即座に **消える**。
    - 共同投稿 (collab) の動画で secondary channel の subscribe 行にも (登録済みなら) ボタンが出る。
    - クリックすると console に `[fuju/youtube] fuju button clicked` が 1 回出る。
    - `https://www.youtube.com/shorts/<id>` ではボタンが **出ない** (別タスクなので意図通り)。
    - X 側 (`https://x.com/`) でアイコン挿入と impression tracker が引き続き動作 (副作用ゼロの確認)。

## テスト要件

- **手動 E2E**: Phase 4 の手順 11。auth state の遷移、lookup 結果 (登録済み / 未登録) の組み合わせとボタン表示の AND 連動が中心。
- **静的検査**: `npm run lint` で型エラー / 未使用 import が無いこと。
- **回帰**: 前タスクで実装した `[fuju/youtube] lookup` ログが従来通り出ること (本タスクの変更で lookup 導線が壊れていないことの確認)。

## 技術的な補足

### DOM 挿入位置の選択肢

DOM サンプルから、subscribe 周辺の構造は以下のとおり:

```
ytd-subscribe-button-renderer
  ytSmartImationsContent  (notification toggle が同じ container にある場合)
    yt-button-shape#subscribe-button-shape  ← subscribe ボタン本体
    div#notification-preference-toggle-button  ← 通知ベル
    yt-animated-action  ← クリックアニメーション
```

挿入位置として 3 案ある:

- **A. subscribe ボタンの直後 (notification toggle の前)** ← **採用 (エンジニア確定)**。subscribe との視覚的な近接性が最大。
- B. notification toggle の後 (= 行末)。視覚的に独立した別アクションとして見える。
- C. `ytd-subscribe-button-renderer` の **外側 sibling** に置く。レイアウトは安定するが、subscribe との関係が見えづらい。

本タスクでは A を採用。挿入箇所は `ensureFujuButton` 内部に集約。

### 認証済み判定の実装方針

- popup と background の auth state は `chrome.storage.local` 上の `accessToken` / `user` で永続化されており、`AuthMessageType.GET_STATE` が SoT (Source of Truth) を返す (`src/popup/auth/AuthProvider.tsx:65-73` と同じ取得経路)。
- content script からも `chrome.runtime.sendMessage` で `GET_STATE` を呼べるので、popup と同じ「初期取得 + `chrome.storage.onChanged` 監視」パターンを移植する。
- `FUJU_USER_LOOKUP` の戻り値 `null` を「未認証」と解釈する案もあるが、これはネットワーク失敗とも区別がつかないので **採用しない**。

### subscribe ボタンの多重存在ケース

- `/watch` ページのチャンネル行に 1 つ。
- 共同投稿 (collab) で `secondaryInfoRenderer` 配下にもう 1 つ出る場合がある (前タスクメモ「collab」)。
  - **エンジニア確定: collab の secondary 側にもボタンを出す**。`findSubscribeButtonHosts()` が複数 host を返した場合は全てに挿入する。
  - **簡易設計**: 全 host に対して「メイン q の lookup 結果が exists=true なら全 host に挿入」とする。collab の secondary channel は本来別の handle / channel ID を持つので個別 lookup が望ましいが、本タスクでは簡易設計を採用し、host 個別の lookup は次タスク以降の改善余地として残す。
  - **将来改善**: `host.querySelector('a[href^="/@"], a[href^="/channel/"]')` から各 host の channel anchor を取り出し、host ごとに `parseChannelHrefToIdentifier` → `fujuData('youtube', q)` → `exists` を判定して挿入可否を切り替える。
- チャンネルヘッダで 1 つ。
- 同一タブで `/watch` → `/@…` → `/watch` と遷移すると、SPA の reuse によって古い host が DOM 上に残るタイミングがある。`dataset.fujuButton` マーカーで重複挿入は防げる。古い host の cleanup は YouTube 側に任せる。

### auth state / lookup 結果の変化と DOM 反映の競合

- 「ログアウト + SPA 遷移」「lookup 結果が遅延で返る + SPA 遷移」等の競合は、`ensureFujuButton` を idempotent に保つことで吸収する。
- `shouldShow` の評価は **常に「最新の auth state」 AND 「最新の q に対する lookup 結果」** で計算する。古い lookup 結果が新しい SPA 遷移後の DOM に適用されないよう、`scanGeneration` ベースの検閲を `runLookup` 内に持たせる (前タスクの retry 中断と同じ思想)。
- `removeAllFujuButtons()` は `document.querySelectorAll('[data-fuju-button="true"]')` で全件削除する単純実装。host 単位で個別管理する必要は当面なし。

### 投げ銭フローへの拡張余地

- `createFujuButton()` の onClick payload に `q` (handle / channel ID) を含めておくと、後続タスクで「クリック → background に投げ銭セッション要求 → AuthCore へ」の差し込みが楽になる。`data-fuju-q` 属性ではなく closure capture で渡す (button が複数 host に出ても各 closure が正しい `q` を持つように、`ensureFujuButton` 呼び出しごとに作り直す)。
- 表示テキスト「ふじゅ〜」は本タスクではハードコード。i18n は別タスク (`public/_locales/ja/messages.json` に登録するかどうかも別途判断)。

### 関連ファイル

- `D:\Docment\program\fuju\fuju-extension\src\content\youtube\index.ts` (改修対象)
- `D:\Docment\program\fuju\fuju-extension\src\content\youtube\channelIdentifier.ts` (参照のみ・既存)
- `D:\Docment\program\fuju\fuju-extension\src\content\youtube\navigation.ts` (参照のみ・既存)
- `D:\Docment\program\fuju\fuju-extension\src\content\shared\api\fujuUserCache.ts` (参照のみ・既存)
- `D:\Docment\program\fuju\fuju-extension\src\shared\auth\messages.ts` (参照のみ・`GET_STATE` を使う)
- `D:\Docment\program\fuju\fuju-extension\src\shared\auth\storage.ts` (`STORAGE_KEYS` を再利用)
- `D:\Docment\program\fuju\fuju-extension\src\popup\auth\AuthProvider.tsx` (参照のみ・auth state 監視パターンの参考)
- `D:\Docment\program\fuju\fuju-extension\src\content\x\userData.ts` (参照のみ・`dataset.inserted` マーカー設計の参考)
- `D:\Docment\program\fuju\fuju-extension\public\manifest.json` (変更不要)

### 関連ドキュメント

- `D:\Docment\program\fuju\fuju-extension\docs\tasks\detect-current-youtube-channel.md` (前タスク)
- `D:\Docment\program\fuju\fuju-extension\docs\tasks\split-content-script-per-service.md` (YouTube content script 雛形)

## 今後の関連タスク (保留事項の切り出し)

1. **Fuju ボタンクリック → 投げ銭フロー** (本タスクでは onClick がスタブ)。
2. **Shorts overlay 上のボタン設置** (DOM 構造が異なるため別タスク)。
3. **i18n 対応** (「ふじゅ〜」の文字列を `_locales/ja/messages.json` に移す)。
4. **共同投稿 secondary 行の host 個別 lookup** (本タスクは簡易設計でメイン q の lookup 結果を全 host に流用。secondary channel が登録されていない場合でもボタンが出る点を改善する)。
5. **デザイン本実装** (現状はインラインスタイルで pill ボタンを暫定実装。subscribe ボタンと完全に揃った見た目にするかは別タスク)。
