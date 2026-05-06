# release 自動化の整備 (Conventional Commits → Web Store publish)

## 概要

`main` へのマージから Chrome Web Store への配布までを 1 アクションで終わらせる release pipeline を整備する。
バージョンは Conventional Commits の prefix から自動判定し、必ず 2 桁目 (minor) か 3 桁目 (patch) のみが動くようにする。

## 背景・目的

現状は手作業 (バージョン上げ・タグ付け・zip 作成・Web Store アップロード・docs 更新) が散らばっており、抜け漏れと release 遅延の原因になっている。release 手順の自動化で手作業を完全に消すのが目的。

加えて、ユーザー / 共同開発者に「何が変わったか」を伝える CHANGELOG をリポジトリに残したい。

## 現状

調査の結果、CI/release 基盤の **8 割は既に実装済み** だった。差分は最小化できる:

- `.github/workflows/pr.yml` — PR 上で `npm run lint` + `npm run build` を実行 ✅
- `.github/workflows/release.yml` — `main` push で release-please を起動し、release が作られたら zip を生成して GitHub Release asset に添付 ✅
- `release-please-config.json` — `extra-files` で `public/manifest.json` の `$.version` を `package.json` と同期 ✅
- `CHANGELOG.md` — release-please が自動生成 (初回 release 時に作成) ✅

足りていないのは以下のみ:

1. **bump policy が 1 桁目 (major) を動かしうる**
   release-please の pre-major モード default では `feat:` も `fix:` も両方 patch (3 桁目) に倒れる。要望は `feat: → minor`, `fix: → patch` の使い分け。
2. **Chrome Web Store への自動 publish が無い**
   現在は GitHub Release に zip を添付するところで止まっている。Web Store 反映は手作業。
3. **release フローの開発者向けドキュメントが無い**
   Conventional Commits 規約と「PR タイトルが minor/patch 判定の起点になる」運用ルールがどこにも書いていない。

## 影響範囲

| ファイル | 種別 | 変更内容 |
| --- | --- | --- |
| `release-please-config.json` | 修正 | `bump-minor-pre-major: true` を追加 (pre-1.0 でも feat→minor / fix→patch に振り分け) |
| `.github/workflows/release.yml` | 修正 | release 確定後に Chrome Web Store API で publish する step を追加 |
| `docs/release.md` | 新規 | release フロー / commit message 規約 / secret セットアップ手順 |
| `README.md` | 修正 | `docs/release.md` への参照リンクを追記 |
| `.github/pull_request_template.md` | 新規 (任意) | Conventional Commits prefix を促すチェック欄を追加 |

破壊的変更なし。既存の `pr.yml` / `package.json` scripts はそのまま。

## 実装ステップ

### 1. release-please の bump policy を pre-major 用に矯正する

`release-please-config.json` の `packages."."` セクションに以下を追加:

```json
"bump-minor-pre-major": true,
"bump-patch-for-minor-pre-major": false
```

これで `0.x.y` 域の挙動が以下に固定される:

| commit prefix | bump 結果 |
| --- | --- |
| `feat:` / `feat(scope):` | `0.x.y` → `0.x+1.0` (minor / 2 桁目) |
| `fix:` / `fix(scope):` | `0.x.y` → `0.x.y+1` (patch / 3 桁目) |
| `chore:` / `refactor:` / `docs:` / `style:` / `test:` | bump なし |
| `BREAKING CHANGE:` フッタ付き | `0.x+1.0` (pre-major なので minor 扱いで吸収) |

1 桁目 (major) は `1.0.0` に到達しない限り絶対に動かない。`1.0.0` への移行は意図的にしか起きない (release-please は pre-major → 1.0.0 を自動で行わない)。

### 2. Chrome Web Store API publish step を `release.yml` に追加

`build` job の末尾、`Attach asset to release` の後に以下の step を追加する:

```yaml
- name: Upload to Chrome Web Store
  uses: mnao305/chrome-extension-upload@v5
  with:
    file-path: fuju-extension-${{ needs.release-please.outputs.tag_name }}.zip
    extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
    client-id: ${{ secrets.CHROME_CLIENT_ID }}
    client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
    refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
    publish: true
```

`mnao305/chrome-extension-upload` は内部で `chrome-webstore-upload` を呼ぶ薄いラッパー。公式 GoogleChromeLabs 製の action は無いので、業界標準の前者を採用。

`publish: true` を指定すると Google 審査に自動 submit される。審査落ち時は GitHub Action のログにエラーが出るのでそこで気付ける。

#### 必要な GitHub Actions secrets

| secret 名 | 取得元 |
| --- | --- |
| `CHROME_EXTENSION_ID` | Chrome Web Store Developer Dashboard の拡張機能詳細ページ |
| `CHROME_CLIENT_ID` | Google Cloud Console で OAuth 2.0 client (Web application) を作成 |
| `CHROME_CLIENT_SECRET` | 同上 |
| `CHROME_REFRESH_TOKEN` | client_id/secret を使って Web Store API のスコープで OAuth flow を 1 度回し、得られた refresh_token を保存 |

セットアップ手順は `docs/release.md` に詳述する。

### 3. `docs/release.md` を新規作成

以下の節を含める:

- **release フローの全体像** (PR → main merge → release-please が release PR を作成 → release PR を merge → tag + GitHub Release + Web Store publish)
- **commit message 規約** (Conventional Commits)
  - `feat:` / `feat(scope):` → minor (2 桁目)
  - `fix:` / `fix(scope):` → patch (3 桁目)
  - `chore:` / `docs:` / `refactor:` / `test:` / `style:` → bump なし
  - `BREAKING CHANGE:` フッタ → minor (pre-1.0)
  - PR を `Squash and merge` する場合は **PR タイトル** が commit message になるので、PR タイトルも prefix を守ること
- **secrets セットアップ手順**
  - Web Store Developer Dashboard で拡張機能 ID を取得
  - Google Cloud Console で OAuth 2.0 client を作成 (Web application タイプ)
  - `chrome-webstore-upload-keys` コマンドで refresh token を 1 度発行
  - GitHub の Settings → Secrets で 4 つの値を登録
- **手動 publish へのフォールバック**
  - secrets が未設定 / 失効した場合は GitHub Release から zip を DL して手動アップロードする手順

### 4. `README.md` に release フローへの参照を追加

「ビルドと配布」セクション末尾に以下を追記:

```markdown
release / Web Store 公開フローは [`docs/release.md`](./docs/release.md) を参照してください。
コミットメッセージ規約 (Conventional Commits) と GitHub Actions secrets のセットアップ手順をまとめています。
```

### 5. (任意) PR template に Conventional Commits の確認チェックを追加

`.github/pull_request_template.md` (もしくは既存テンプレに追記):

```markdown
## release notes
- [ ] PR タイトルは Conventional Commits 規約 (`feat:` / `fix:` / `chore:` / ...) に従っている
- [ ] バージョン bump が必要な変更 (機能追加 = `feat:`, バグ修正 = `fix:`) を理解した上で prefix を選んでいる
```

## テスト要件

- **単体検証**: `release-please-config.json` の json schema validation がローカルで通る (`npx release-please --help` などで構文確認)
- **統合検証**: develop branch で test PR を作って main へ merge → release-please が release PR を作る → release PR を merge → Web Store API のレスポンスが 2xx になることをログで確認
- **secret 未設定時の挙動**: secret が無い状態で release.yml を回すと Web Store step だけ失敗 (それ以外の release / zip 添付は成功) することを確認

## 技術的な補足

### release-please が「2 つの PR」を作る前提

release-please は `main` への push を受けると **release PR** を作る (manifest.json と CHANGELOG.md を更新する PR)。この release PR は機能 PR ではなく、release-please bot の自動生成。

**release が確定するのは「release PR を merge した瞬間」**。普通の機能 PR を merge しただけでは release は走らない。これは既存の `release.yml` の設計通りで、本タスクで変更しない。

### Web Store の審査時間

`publish: true` で auto submit すると、Google の審査キューに乗る。標準的な拡張機能なら 1〜数時間で公開される。reviewer による手動検査が走った場合は数日かかる。本タスクでは「自動 submit までを CI で完結」とし、審査結果通知は Web Store Developer Dashboard 側で運用する。

### 既存 release-please-config.json との整合

既に `extra-files` で `public/manifest.json` の `$.version` を sync する設定があるので、bump 確定後に manifest.json も自動更新される。本タスクの bump policy 変更とは独立に動作する。

### `chrome.cookies` permission の整理は本タスクの対象外

`docs/overview.md` の TODO に挙がっている `chrome.cookies` permission の最終削除は別タスク (`docs/tasks/support-extension-bearer-only-flow.md` Phase 3 系) で行う。本タスクでは触らない。
