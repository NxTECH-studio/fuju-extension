# Release ガイド

`main` へのマージから Chrome Web Store 公開までの自動化フローと、その運用ルールをまとめます。

## 全体像

```
feature PR → develop merge → ... → develop → main PR → main merge
                                                          ↓
                                              release-please が release PR を作成
                                                          ↓
                                                 release PR を merge
                                                          ↓
                                  tag 付与 → GitHub Release 作成 → dist.zip 添付
                                                          ↓
                                          Chrome Web Store API へ submit (auto publish)
```

ポイントは **release が確定するのは「release PR を merge した瞬間」** だということです。
通常の機能 PR を `main` にマージしただけでは tag や release は作られません。代わりに release-please bot が
「次の release 候補」をまとめた release PR を自動更新します。それを merge して初めて release.yml の build job が走ります。

## バージョニング規約

`0.x.y` 域では以下のルールに固定されています (`release-please-config.json` の `bump-minor-pre-major: true`)。

| commit prefix | bump 結果 | 例 |
| --- | --- | --- |
| `feat:` / `feat(scope):` | minor (2 桁目) | `0.1.0` → `0.2.0` |
| `fix:` / `fix(scope):` | patch (3 桁目) | `0.1.0` → `0.1.1` |
| `chore:` / `refactor:` / `docs:` / `style:` / `test:` / `build:` / `ci:` | bump なし | release PR に含まれない |
| `BREAKING CHANGE:` フッタ付き | minor (2 桁目) | pre-1.0 では minor で吸収 |

**1 桁目 (major) は `1.0.0` に到達するまで絶対に動きません。** `1.0.0` への移行は意図的に手動で行います。

### Squash merge と PR タイトルの関係

このリポジトリは Squash and merge を前提にしています。Squash すると **PR タイトルが commit message の 1 行目** になるため、PR タイトル自体が Conventional Commits 規約に従う必要があります。

良い例:
- `feat(content): impression tracker を実装`
- `fix(auth): refresh token 更新時の race を修正`
- `chore: dependencies を bump`

悪い例:
- `impression tracker 実装` ← prefix なし、release-please が認識できない
- `[FEAT] add tracker` ← 規約違反

PR template に確認チェック欄を入れているので、merge 前に必ず確認してください。

## Chrome Web Store secrets セットアップ

CI が Web Store にアップロードするには以下 4 つの GitHub Actions secret が必要です。

| secret 名 | 取得元 |
| --- | --- |
| `CHROME_EXTENSION_ID` | [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) の拡張機能詳細ページの URL から取得 |
| `CHROME_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で OAuth 2.0 client (Web application) を作成 |
| `CHROME_CLIENT_SECRET` | 同上 |
| `CHROME_REFRESH_TOKEN` | 下記手順で発行 |

### refresh token の発行手順 (初回のみ)

1. Google Cloud Console で **Chrome Web Store API** を有効化する
2. OAuth 2.0 client (Web application) を作成し、redirect URI に `https://developers.google.com/oauthplayground` を追加する
3. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) を開く
4. 右上歯車 → "Use your own OAuth credentials" にチェックを入れ、step 2 の client_id / client_secret を入力
5. 左ペインで scope `https://www.googleapis.com/auth/chromewebstore` を入力 → "Authorize APIs"
6. Web Store Developer Dashboard を所有する Google アカウントでログインを許可する
7. "Exchange authorization code for tokens" をクリックすると `refresh_token` が表示される

得られた値を GitHub の `Settings → Secrets and variables → Actions` に登録してください。

### secrets が未設定 / 失効した場合のフォールバック

`Publish to Chrome Web Store` step だけが失敗し、それ以前の GitHub Release / dist.zip 添付は成功しているため、
以下の手順で手動アップロードできます:

1. GitHub Release ページから `fuju-extension-vX.Y.Z.zip` をダウンロード
2. Web Store Developer Dashboard で「新しいバージョンをアップロード」 → ダウンロードした zip を選択
3. 「審査用に送信」をクリック

修正を加えた secret を再設定したら、次の release から自動 publish が復旧します。

## release を起こす手順 (開発者向け)

1. feature ブランチを切る (`feat/xxx` / `fix/xxx` / `chore/xxx`)
2. Conventional Commits 規約に従ったコミットを積む
3. PR を `develop` に向けて作成 (Squash 前提なので **PR タイトルも prefix を守る**)
4. lint / build (PR Checks) が green になったら merge
5. `develop` から `main` へ統合 PR を作成し merge
6. release-please が `chore(main): release X.Y.Z` という release PR を生成 (内容は CHANGELOG diff と manifest/package.json の version bump)
7. **release PR を merge する** → tag 付与・GitHub Release 作成・Web Store submit が自動実行
8. Web Store の審査が通れば公開される (通常 1〜数時間、手動 review 入りで数日)

## 付録: 確認事項チェックリスト

- [ ] PR タイトルが `feat:` / `fix:` / `chore:` のいずれかで始まっている
- [ ] release PR の差分 (`CHANGELOG.md` / `package.json` / `public/manifest.json`) が想定どおりのバージョンになっている
- [ ] Web Store Developer Dashboard 側で必要に応じてストア情報 (説明文 / スクリーンショット) を更新済み
