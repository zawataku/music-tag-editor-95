# 音楽タグエディタ

Win98 / Office97 風の音楽タグエディタ。Electron アプリとして動作する。
フォルダやファイルを開き、一覧から選んで、タイトル・アーティスト・アルバム・
アートワークなどを編集して保存する。ライブラリ管理や再生はしない。

対応形式: MP3 (`.mp3`) / M4A (`.m4a` `.m4b` `.mp4`) / FLAC (`.flac`) / OGG (`.ogg` `.oga` `.opus`)

## 起動

```
npm install
npm start
```

`npm install` で Electron 本体が取得されないことがある（npm の allow-scripts）。
`npm start` が `Electron failed to install correctly` で止まる場合は
`node node_modules/electron/install.js` を実行する。

## テスト

```
npm test
```

`node --test` で `test/*.test.js` を実行する。タグの読み書き（`main/tags.js`）、
フォルダ走査（`main/scan.js`）、複数選択と差分の管理（`renderer/model.js`）が対象。
画面は `docs/manual-test.md` の手順で手動確認する。

## 配布物のビルド

```
npm run dist:win     # NSISインストーラ + ポータブル (x64)
npm run dist:dir     # 展開済みディレクトリのみ（動作確認用、速い）
```

アプリのアイコン（`build/icon.ico` `build/icon.png`）は、タイトルバー左上の音符と同じ図形を
`scripts/make-icon.js` で描いたもの。音符を変えたら同じ図形をスクリプトにも反映し、`npm run icon` で作り直す。

## 構成

```
main.js              メインプロセス。ウィンドウ・ダイアログ・IPC ハンドラ
main/tags.js         node-taglib-sharp ラッパー（読み込み・安全な書き込み）
main/scan.js         パス展開（ファイル/フォルダ → 対象音楽ファイルの一覧）
preload.js           contextBridge。window.desktop を公開
renderer/index.html  UI（HTML）
renderer/style.css   スタイル
renderer/model.js    複数選択時の値の統合と未保存の差分（DOM 非依存。テスト対象）
renderer/app.js      レンダラーのロジック
test/                単体テストと各形式の小さなサンプル（test/fixtures/README.md）
scripts/make-icon.js アイコン生成（npm run icon）
build/               生成済みのアイコン（タスクバー・exe 用）
```

`renderer/index.html` はブラウザ単体では動かない。node-taglib-sharp が Node 専用のため、
タグの読み書きはすべてメインプロセスで行う。

### データの流れ

- 開く/ドロップ → `expand` で対象ファイルに展開 → 4 並列で `readTags` → 届いた順に一覧へ追加。
- 編集は各ファイルの `patch`（ディスク上の値と違うキーだけ）に貯める。
  複数選択で一度も触れなかった欄は、どのファイルにも書かない。
- 保存は `patch` のあるファイルを 1 件ずつ `writeTags`。失敗したファイルは `patch` を残して赤字にする。
- アートワーク本体は一覧の読み込みでは運ばない（hash だけ）。アートワークタブを開いたときに取得する。

## 実装メモ

- **安全な書き込み**: taglib はファイルをその場で書き換えるので、同じフォルダに
  `.<名前>.mte-tmp.<拡張子>` としてコピー → 書き込み → 読み直して検証 → `rename` で置き換える。
  失敗したら一時ファイルを消し、元ファイルには触れない。拡張子を残すのは taglib が拡張子で形式を判定するため。
  ドットで始まるので、フォルダ走査でも拾わない。
- **ID3v2.3**: Windows のエクスプローラーは ID3v2.4 を読めないので、MP3 は常に v2.3 で保存する。
  ジャンルは ID3v1 の番号参照（`(17)`）ではなく文字列で書く（複数は `Rock;Pop`）。
- **複数値**: アーティスト・アルバムアーティスト・作曲者・ジャンルは `; ` 区切りで表示・入力する。
- **アートワーク**: 表紙（FrontCover、無ければ先頭の画像）だけを表示・置換・削除し、それ以外の画像は残す。
  形式は先頭バイトで判定し、JPEG と PNG 以外は受け付けない。
- **DPI**: ビットマップフォントは非整数倍で崩れるので
  `force-device-scale-factor=1` を `app.whenReady()` より前に設定している。
- **File.path**: Electron 32 で削除済み。`webUtils.getPathForFile()` を
  preload から呼ぶこと（レンダラーからは呼べない）。
- **フレームレス**: `frame: false` + HTML 製タイトルバー。
  ドラッグは `-webkit-app-region: drag`、ボタンは `no-drag`。
- **ネイティブメニュー**: `Menu.setApplicationMenu(null)` で無効化。
  メニューバーとダイアログは HTML で自作している（ネイティブはファイル選択/保存のみ）。
- **終了確認**: メインプロセスがウィンドウの `close` を止めてレンダラーに問い合わせ、
  未保存の確認が済んだら `confirmClose()` で閉じる。
- **CSP**: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'`。
  アートワークは `Blob` の URL で表示するので `blob:` が必須。通信は一切しない。

## 既知の制限

- 一覧は仮想スクロールではない。数千件で描画が重くなる（3000 件の読み込みで約 3 秒）。
  フォルダ走査は深さ 8、20000 件で打ち切る。
- 表紙以外の画像は編集できない（保持のみ）。
- 歌詞・読み仮名（ソート用）・BPM などは編集できない。既存の値は保持される。
- 保存するとファイルの更新日時が変わる。
- MP3 の複数ジャンルは ID3v2.3 に標準の区切りが無いため `;` で区切っている。
  アプリによっては 1 つのジャンル名として表示される。
