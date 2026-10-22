# music-tag-editor-95

Win98 風の音楽タグエディタ（Electron + node-taglib-sharp）。

- 設計書: `docs/superpowers/specs/2026-10-22-music-tag-editor-95-design.md`
- 実装計画: `docs/superpowers/plans/2026-10-22-music-tag-editor-95.md`
- 外観・構成の参考: 兄弟リポジトリ `exif-viewer-95`

## 規約

- コミットメッセージは「追加：」「修正：」「変更：」「削除：」など日本語 + 全角コロンで始める（gitmoji は使わない）。
- テスト: `npm test`（`node --test`）。

## 進捗（2026-10-22 時点、ブランチ `feature/v1`）

- Task 1〜5 完了（雛形、`main/tags.js` 読み書き、`main/scan.js`、`renderer/model.js`）。
- Task 6 完了。Electron 上で preload/IPC 経由の expand・readTags・writeTags・readArtwork・終了確認フローを確認済み（DevTools Protocol 経由）。
  ネイティブのフォルダ選択ダイアログのクリック確認のみ未実施（Task 7 Step 4 の手動確認で兼ねる）。
  `renderer/index.html` / `renderer/probe.js` は Task 6 Step 2 用の一時ファイル（未コミット）。Task 7 で置き換え、`probe.js` は削除する。
  次は Task 7 から。

## 実装時の判断（計画からの逸脱）

- `npm test` は `node --test`（ディレクトリ引数はエラーになるため）。
- 一時ファイル名は `.<stem>.mte-tmp.<ext>`（taglib は拡張子で形式を判定するため）。
- 表紙（FrontCover）を削除し他の画像が残る場合、残った先頭画像が「アートワーク」として表示される（「FrontCover、無ければ先頭」の規則どおり）。
- `expand(paths, { maxFiles })` はテスト用に上限を引数で変えられる。
- `openFiles()` / `openFolder()` はパス配列（キャンセル時 `null`）を返し、展開はレンダラーが `expand()` で行う。
- 「失敗時は元ファイル不変」テストは、Windows ではディレクトリ権限が効かないためファイル自体を読み取り専用にして失敗させる。

## 環境メモ

- `npm ci` では npm の allow-scripts により Electron 本体が取得されないことがある。その場合は `node node_modules/electron/install.js` を実行する。
