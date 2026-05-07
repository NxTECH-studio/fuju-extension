## 概要

<!-- 変更の目的と概要を 1〜2 文で書く -->

## 細かい変更点

<!-- 具体的な変更点を箇条書き -->

## 影響範囲・懸念点

<!-- 影響範囲や懸念点。なければ「なし」 -->

## その他

<!-- レビュー観点・関連 issue 等。なければ「なし」 -->

## Conventional Commits 確認

<!--
Squash and merge 前提のため PR タイトルが Squash 後の commit 1 行目になります。
release-please は PR タイトルの prefix から minor (`feat:`) / patch (`fix:`) を
判定するので、タイトル自体が規約に従う必要があります。詳細は docs/release.md。
-->

- [ ] PR タイトルが `feat:` / `fix:` / `chore:` / `refactor:` / `docs:` / `style:` / `test:` / `build:` / `ci:` のいずれかで始まっている
- [ ] バージョン bump 対象 (機能追加 = `feat:`, バグ修正 = `fix:`) かどうかを意識した prefix を選んでいる
