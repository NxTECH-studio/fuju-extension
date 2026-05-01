# プロジェクト概要 docs の整備と manifest の i18n 化

## 概要

新規参加する開発者向けに、`fuju-ext` の現状機能・実装サマリをまとめた `docs/overview.md` を新規作成する。あわせて `public/manifest.json` の `name` / `description` / `default_title` を Chrome 拡張の i18n 機構（`__MSG_*__` + `_locales/<lang>/messages.json`）でローカライズする。primary（`default_locale`）は日本語 (`ja`)、secondary は英語 (`en`)。

## 背景・目的

- **docs**: 現状 README.md は AuthCore 連携や開発手順が中心で、拡張機能の「何ができる/どこに何が書いてある」のサマリが分散している。新規参加者が短時間でコードベースの全体像を掴めるようにしたい。`docs/tasks/*` には個別タスクの実装計画はあるが、プロジェクト横断の俯瞰ドキュメントは不在。
- **manifest i18n**: 現状 `public/manifest.json` は `name: "Auto Form Input"` / `description: "Base Level Extension"` / `default_title: "Auto Form Input"` が英語ハードコード。プロジェクト名 (`fuju-extension`) や popup UI（日本語）と整合せず、ストア配布や日本語ユーザーへの体験として不適切。Chrome 拡張標準の i18n（`_locales/`）に乗せて、ja を primary、en を secondary とする。

## 影響範囲

### 新規追加

- `docs/overview.md`（新規） — 開発者向けの現状機能・実装サマリ。
- `public/_locales/ja/messages.json`（新規） — 日本語メッセージ（primary）。
- `public/_locales/en/messages.json`（新規） — 英語メッセージ（secondary）。

### 既存ファイルの変更

- `public/manifest.json`
  - `name` / `description` / `action.default_title` を `__MSG_<key>__` プレースホルダに変更。
  - `default_locale: "ja"` を追加。
- `README.md`
  - 「Project layout」「冒頭の説明」あたりに `docs/overview.md` への導線を追記（任意。本タスクの範囲では最小限の追記に留める）。

### 変更しないもの

- `popup` UI 内の文言（`LoginForm.tsx` / `MfaForm.tsx` / `Dashboard.tsx` 等の日本語文字列）。**今回のローカライズ対象は manifest の 3 フィールドのみ**。
- `popup.html` の `<title>` / `lang` 属性。manifest 変更の検証中に気付き次第 follow-up 化（範囲外）。
- ビルド構成 (`vite.config.ts`)。`public/_locales/` は Vite が自動で `dist/_locales/` にコピーする（`public/` 配下の静的アセットの標準挙動）ため追加設定は不要。
- 既存の `public/manifest.json` の `permissions` / `host_permissions` / `content_scripts` / `background` 等。

### 破壊的変更

- 拡張機能の表示名が「Auto Form Input」から **日本語環境では「Fuju 拡張機能」**（仮、§実装ステップで確定）に変わる。Chrome の拡張一覧 / ストア表示 / ツールチップで体感できる表示変化が発生するが、機能や API は変わらない。

## 実装ステップ

### Phase 1: `docs/overview.md` の作成

1. `docs/overview.md` を新規作成し、以下のセクション構成で現状をまとめる。実装は既に存在するため**コードを読みつつ「何が・どこに・なぜ」を要約する**形にする。新たな仕様判断はしない。
   - **目的**: `fuju-ext` が解決する課題（X / Twitter のタイムライン上で Fuju ユーザーかどうかをアイコン表示する Chrome 拡張、AuthCore 認証で利用ユーザーを識別する）。
   - **構成**: Manifest V3 の 3 サーフェス（popup / background service worker / content script）と、それぞれの役割。
   - **主要機能**:
     - **認証**: AuthCore 連携の通常ログイン + TOTP MFA（`docs/tasks/implement-login-with-persistence.md`, `docs/tasks/support-mfa-login.md` 参照）。トークンの永続化、自動 refresh、ログアウト。
     - **コンテンツスクリプト**: `x.com` / `twitter.com` のタイムラインで `[data-testid="tweet"]` を MutationObserver で監視し、`User-Name` 内に Fuju アイコンを差し込む（`src/content/x/userData.ts`）。`/api/fuju-user/<userId>` に問い合わせ、`Map` ベースのキャッシュ + 進行中リクエスト共有 (`src/content/api/fujuUserCache.ts`) で重複 fetch を抑制。ローディング中は自前 SVG アイコン (`src/content/img/loadingIcon.ts`) を表示。
   - **ディレクトリ構成**: 既存の `src/` 階層を簡潔に（`background/`, `content/`, `popup/`, `shared/auth/`, `shared/config.ts` の各責務を 1〜2 行で）。
   - **メッセージプロトコル**: popup ↔ background の `AuthMessageType`（`AUTH_LOGIN` / `AUTH_MFA_VERIFY` / `AUTH_MFA_CANCEL` / `AUTH_LOGOUT` / `AUTH_GET_STATE` / `AUTH_REFRESH` / `AUTH_FETCH`）と、`isTrustedSender` でコンテンツスクリプトからの呼び出しを拒否している点 (`src/background/message-handler.ts`)。
   - **ストレージとセキュリティ要点**:
     - access token / refresh token / accessTokenExp / user は `chrome.storage.local` に永続化 (`src/shared/auth/storage.ts`)。
     - **pre_token は memory only**（service worker 再起動で破棄、`MFA_NOT_PENDING` で popup を LoginForm に戻す）。
     - refresh token は `Path=/v1/auth` の HttpOnly Cookie で配送、background が `chrome.cookies.get` で読み出して `chrome.storage.local` にバックアップ (`src/background/auth-manager.ts`)。
     - Refresh 並行発火を `refreshInflight` で 1 本化（Refresh Token Rotation の family 失効回避）。
     - `chrome.alarms` で access_token expiry の `expires_in - 60s` 前にリフレッシュをスケジュール。
   - **ビルドと配布**: `npm run dev` (Vite watch) / `npm run build`（`tsc -b` + `vite build`）。`dist/` を `chrome://extensions` で unpacked ロード。`public/manifest.json` がそのまま `dist/manifest.json` に出力される。
   - **環境変数**: `.env.example` の `VITE_AUTHCORE_BASE_URL`（デフォルト `http://localhost:8080`）。
   - **既知の制約 / TODO**:
     - 拡張機能 ID が unpacked と公開版で異なるため、AuthCore 側 `ALLOWED_ORIGINS` の管理が必要（README にも既述）。
     - `src/content/api/fujuUserCache.ts` の `fetch('/api/fuju-user/<userId>')` は X.com の同一オリジンに飛ぶ（host_permissions 範囲）。Fuju 自前 API のエンドポイント仕様は本拡張のリポジトリ外であり、未確定の可能性あり。
     - popup UI 内の文言は日本語ハードコード（i18n 未対応）。本タスクの範囲外。
     - recovery code 対応 / WebAuthn は未対応（`docs/tasks/support-mfa-login.md` 「将来の拡張」参照）。
   - **関連ドキュメント**: `README.md`, `docs/tasks/implement-login-with-persistence.md`, `docs/tasks/support-mfa-login.md`。
2. **想定されるコード／仕様の不確実点**は overview.md に断定形で書かず、「現状の実装ではこうなっている」「未確認」と明記する。特に `fuju-user` API（content script の問い合わせ先）はリポジトリ外仕様のため、断定しない。

### Phase 2: `_locales/` ディレクトリと messages.json の作成

3. `public/_locales/ja/messages.json` を作成。primary 言語。

   ```json
   {
     "extName": {
       "message": "Fuju 拡張機能",
       "description": "Chrome 拡張のストア表示名 (manifest.name)。"
     },
     "extDescription": {
       "message": "X (Twitter) のタイムライン上で Fuju ユーザーを識別し、AuthCore でログインするブラウザ拡張機能です。",
       "description": "Chrome 拡張のストア説明文 (manifest.description)。"
     },
     "actionDefaultTitle": {
       "message": "Fuju 拡張機能を開く",
       "description": "ツールバーアイコンのツールチップ (manifest.action.default_title)。"
     }
   }
   ```

   - 文言の最終確定はレビュー時に。「Fuju 拡張機能」「Fuju Extension」あたりが第一候補だが、リポジトリ名 `fuju-ext` / `fuju-extension`（package.json）に揃えるか別ブランディングにするかはレビューで確認する。
4. `public/_locales/en/messages.json` を作成。secondary 言語。

   ```json
   {
     "extName": {
       "message": "Fuju Extension",
       "description": "Display name of the extension on the Chrome Web Store (manifest.name)."
     },
     "extDescription": {
       "message": "Browser extension that highlights Fuju users on X (Twitter) timelines and signs in via AuthCore.",
       "description": "Store description (manifest.description)."
     },
     "actionDefaultTitle": {
       "message": "Open Fuju Extension",
       "description": "Tooltip for the toolbar action button (manifest.action.default_title)."
     }
   }
   ```

5. キー命名は Chrome 拡張 i18n の慣例（`extName` / `extDescription`）に揃える。`description` フィールドは翻訳者向けメタ情報なので各言語で同じ英文で OK（仕様上 ja 側にも入れておくのが標準）。

### Phase 3: `manifest.json` の i18n 化

6. `public/manifest.json` を以下に修正。

   ```json
   {
     "manifest_version": 3,
     "default_locale": "ja",
     "name": "__MSG_extName__",
     "description": "__MSG_extDescription__",
     "version": "0.1.0",
     "action": {
       "default_popup": "popup.html",
       "default_title": "__MSG_actionDefaultTitle__"
     },
     "background": { ... 既存のまま ... },
     "content_scripts": [ ... 既存のまま ... ],
     "permissions": ["storage", "activeTab", "cookies", "alarms"],
     "host_permissions": [ ... 既存のまま ... ]
   }
   ```

   - `default_locale: "ja"` を **必ず** 追加（`__MSG_*__` を使う manifest の必須フィールド）。
   - 他のキーは触らない。
7. `dist/manifest.json` は `npm run build` で再生成されるが、リポジトリにコミットされている `dist/` は生成物のため **本タスクでは編集しない**（既存運用に従う）。CI / リリース時の生成物が `_locales/` も含めて出力されることだけ確認する。

### Phase 4: README への導線追加（最小）

8. `README.md` の冒頭または「Project layout」セクション直後に、`docs/overview.md` への 1 行リンクを追加する。
   ```markdown
   For a project-wide tour (features, layout, message protocol, storage), see
   [`docs/overview.md`](./docs/overview.md).
   ```
   - これ以上の README 改変はしない（範囲を膨らませない）。

### Phase 5: 動作検証

9. `npm run build` でビルドが成功し、`dist/manifest.json` と `dist/_locales/{ja,en}/messages.json` が出力されることを確認。
10. `chrome://extensions` で `dist/` を unpacked ロード。
    - **ja 環境（Chrome の言語設定が日本語）**: 拡張一覧の名称が「Fuju 拡張機能」、説明文が日本語、ツールバーアイコンのツールチップが「Fuju 拡張機能を開く」になる。
    - **en 環境**: 名称が「Fuju Extension」、説明文・ツールチップが英語になる。
    - 確認手段: Chrome の `chrome://settings/languages` で表示言語を切り替え、拡張を再ロードすると i18n 結果が反映される（要 Chrome 再起動の場合あり）。
11. popup を開いてログイン UI（日本語ハードコード）が今まで通り動作することを確認（manifest 変更による副作用がないこと）。
12. 念のため、`chrome.i18n.getMessage('extName')` を popup の DevTools で実行し正しく解決されることを確認（任意）。

## テスト要件

- 自動テスト基盤がリポジトリに無いため、本タスクは **手動 E2E** のみ。
- 検証観点:
  - ja / en それぞれのロケールで manifest の 3 フィールドが正しい言語に解決される。
  - 不正な `__MSG_*__` プレースホルダ（タイポ等）が残っていないこと（Chrome の拡張ロード時にエラーになる）。
  - `default_locale` が無いと `__MSG_*__` プレースホルダがそのまま表示される（regression check）。
- ドキュメントレビュー観点:
  - `docs/overview.md` の記述がコードと矛盾していないか。特に `auth-manager.ts` のメッセージ型と pre_token の memory only 方針 (`docs/tasks/support-mfa-login.md` で確定済み) を踏襲できているか。
  - X / Twitter content script の挙動（`User-Name` の 2 番目の子の前に挿入する点等）の記述が `src/content/x/userData.ts` と一致しているか。

## 技術的な補足

### Chrome 拡張 i18n の前提

- `__MSG_*__` プレースホルダが解決されるのは manifest の特定フィールド（`name`, `short_name`, `description`, `default_title` など）と、`chrome.i18n.getMessage()` 経由のスクリプト呼び出し。
- `default_locale` で指定した言語の `messages.json` が必ず存在しないと拡張がロードできない。本タスクでは `ja` を `default_locale` にするため、`public/_locales/ja/messages.json` は必須。
- ロケールの解決順は Chrome の表示言語に基づき、該当言語の `_locales/<lang>/` がなければ `default_locale` にフォールバック。今回 `ja` / `en` の 2 言語のみ用意するため、それ以外の言語環境では ja が表示される（要件: primary=ja）。
- ロケールコードはハイフン形式（`en-US`）も使えるが、今回はシンプルに `ja` / `en` のみとする（ヒアリング回答 §質問2 に従う）。

### `dist/` の生成物について

- `dist/manifest.json` / `dist/_locales/` は Vite ビルド時に自動生成される。`public/` 以下のファイルは Vite の標準動作で `dist/` 直下にコピーされるため、`vite.config.ts` を変更する必要はない。
- ただし現リポジトリは `dist/` をコミットしているため、レビュー前に **`npm run build` を実行して `dist/` を最新化**してから commit するか、`dist/` を別 commit にするかをコミット粒度で配慮する（既存運用に倣う）。

### popup UI 文言は対象外（理由の補足）

- popup 内の React コンポーネントの日本語文字列も `chrome.i18n.getMessage()` で多言語化することは技術的に可能だが、ヒアリング回答 §質問3 で **本タスクの対象は manifest 3 フィールドのみ** と確定した。
- 将来 popup UI もローカライズする場合は、別タスクとして以下が必要:
  - `chrome.i18n` の薄いラッパー or `react-intl` 等の導入
  - 既存日本語文字列のキー化（`LoginForm.tsx` / `MfaForm.tsx` / `Dashboard.tsx` / `App.tsx` のローディング文言など）
  - `default_locale` を維持しつつ各言語のメッセージ追加

### `docs/overview.md` のスタンス

- **新規仕様の追加・推奨アーキテクチャの提案はしない**。あくまで「現状こうなっている」のサマリ。
- `docs/tasks/*` の既存タスク計画と矛盾する記述を出さない。特に MFA / pre_token の扱い、Refresh Token Rotation の並行発火制御、`MFA_NOT_SUPPORTED` の deprecated 残置などは既存タスクに合わせる。
- 本タスクの完了後も、コード変更で陳腐化する可能性があるため、overview.md に「最終更新: YYYY-MM-DD（コミットハッシュ）」程度の注記を入れるか、navigational doc としての立ち位置を明示すると保守しやすい（任意）。

### コミット粒度の提案

- `docs: add project overview` と `feat(manifest): localize name/description/default_title (ja primary, en secondary)` の 2 コミットに分けると review 容易。
- 1 コミットでまとめても可（依頼の趣旨は「docs + manifest の修正コミット」）。チームの Conventional Commits 慣例に合わせる。
