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
- Task 7 完了。DnD 読み込み・既定順/列ソート・Ctrl/Shift/Ctrl+A/矢印キー選択・エラー行・追記ドロップの重複無視・バージョン情報・終了を CDP 経由で確認済み（3000 件で約 3 秒）。
  未確認: ネイティブの「開く」「フォルダを開く」ダイアログ経由の読み込み（手動でクリックが必要）。
  次は Task 8 から。

## 実装時の判断（計画からの逸脱）

- `npm test` は `node --test`（ディレクトリ引数はエラーになるため）。
- 一時ファイル名は `.<stem>.mte-tmp.<ext>`（taglib は拡張子で形式を判定するため）。
- 表紙（FrontCover）を削除し他の画像が残る場合、残った先頭画像が「アートワーク」として表示される（「FrontCover、無ければ先頭」の規則どおり）。
- `expand(paths, { maxFiles })` はテスト用に上限を引数で変えられる。
- `openFiles()` / `openFolder()` はパス配列（キャンセル時 `null`）を返し、展開はレンダラーが `expand()` で行う。
- 一覧は読み込み中も現在のソート順の位置に行を差し込む（120ms ごとにまとめて再描画）。
- 「開く」系（一覧の置き換え）は実行中の読み込みを打ち切る。ドロップ（追記）は並行して走り、読み込み中のパスも重複として除外する。
- 一覧が空の状態で開いた／ドロップしたのがフォルダ 1 つならタイトルにそのパス、それ以外は「N 個のファイル」。
- 表示メニューに「詳細」「アートワーク」（タブ切替。Task 8 で有効化）を置いた。
- `app.js` の終了要求は現状そのまま `confirmClose()`。Task 8 で未保存確認に置き換える。
- 「失敗時は元ファイル不変」テストは、Windows ではディレクトリ権限が効かないためファイル自体を読み取り専用にして失敗させる。

## 環境メモ

- `npm ci` では npm の allow-scripts により Electron 本体が取得されないことがある。その場合は `node node_modules/electron/install.js` を実行する。
- UI の自動確認は `electron . --remote-debugging-port=9333` で起動し、DevTools Protocol で行う。
  ファイルのドロップは `Input.dispatchDragEvent`（`data.files` に絶対パス）で再現でき、`pathForFile` も実パスを返す。
