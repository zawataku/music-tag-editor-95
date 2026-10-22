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
- Task 6（`main.js` / `preload.js`）はコード作成・コミット済みだが、Electron 起動での動作確認が未実施。
  次は Task 6 Step 2 の起動確認から再開し、Task 7 以降へ進む。

## 実装時の判断（計画からの逸脱）

- `npm test` は `node --test`（ディレクトリ引数はエラーになるため）。
- 一時ファイル名は `.<stem>.mte-tmp.<ext>`（taglib は拡張子で形式を判定するため）。
- 表紙（FrontCover）を削除し他の画像が残る場合、残った先頭画像が「アートワーク」として表示される（「FrontCover、無ければ先頭」の規則どおり）。
- `expand(paths, { maxFiles })` はテスト用に上限を引数で変えられる。
- `openFiles()` / `openFolder()` はパス配列（キャンセル時 `null`）を返し、展開はレンダラーが `expand()` で行う。
