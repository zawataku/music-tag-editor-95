# 音楽タグエディタ 95 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MP3/M4A/FLAC/OGG の標準タグとアートワークを編集できる Win98 風 Electron タグエディタを作る。

**Architecture:** メインプロセスの `main/tags.js` が node-taglib-sharp を包み、一時ファイル経由で安全に書き込む。レンダラーは差分（patch）を保持し、保存時にまとめて IPC で書く。複数選択時の値の統合ロジックは DOM 非依存の `renderer/model.js` に切り出して単体テストする。

**Tech Stack:** Electron 43.8.x, node-taglib-sharp 6.0.3, electron-builder 26.x, `node --test`（Node 24）

**Spec:** `docs/superpowers/specs/2026-10-22-music-tag-editor-95-design.md`

## Global Constraints

- コミットメッセージは「追加：」「修正：」「変更：」「削除：」+ 全角コロンで始める。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 外観・クロームは `../exif-viewer-95` を踏襲（トークン、ベベル、フレームレス、HTML メニュー、`force-device-scale-factor=1`）。
- CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'`
- 通信は一切しない。`contextIsolation: true`, `nodeIntegration: false`。
- 対象拡張子: `.mp3 .m4a .m4b .mp4 .flac .ogg .oga .opus`
- フォルダ走査: 最大深さ 8、最大 20000 件。
- MP3 は ID3v2.3 で保存（`Id3v2Settings.defaultVersion = 3; forceDefaultVersion = true`）。
- 複数値フィールドの表示/入力区切りは `; `（入力時は `;` で分割し前後空白を除去、空要素は捨てる）。
- 数値の未設定は 0、文字列の未設定は `''`。
- アートワークは JPEG / PNG のみ。10 MB 超は確認ダイアログ。
- ダイアログは HTML 製 Win98 風モーダル。ネイティブはファイル選択/保存のみ。

## Review Focus

1. **taglib が開けない/壊れたファイル**（拡張子だけ .mp3 のテキスト等）→ 例外で一覧読み込み全体が止まらず、その行だけエラー行になる。→ Task 2 にテスト追加。
2. **書き込み中の失敗**（読み取り専用・別アプリでロック）→ 元ファイルのバイト列が不変で、一時ファイル `.<name>.mte-tmp` が残らない。→ Task 3 にテスト追加。
3. **複数選択で一部だけ触った欄**→ 触っていない欄は patch に入らず、他ファイルの値を上書きしない。値を元に戻すと未保存表示が消える。→ Task 5 にテスト追加。
4. **表紙以外の画像を持つファイルへのアートワーク置換/削除**→ 表紙以外の画像が保持される。→ Task 3 にテスト追加。
5. **一時ファイルの残骸**（`.mte-tmp`）がフォルダ走査で拾われる → 一覧に出ない。→ Task 4 にテスト追加。

---

### Task 1: プロジェクト雛形とテスト用サンプル

**Files:**
- Create: `package.json`, `.gitignore`, `test/fixtures/README.md`, `test/fixtures/make.sh`, `test/fixtures/blank.{mp3,m4a,flac,ogg}`, `test/fixtures/cover-red.png`, `test/fixtures/cover-blue.jpg`, `test/fixtures/broken.mp3`

**Interfaces:**
- Produces: `npm test` = `node --test test/`、フィクスチャのパス `test/fixtures/*`

- [ ] **Step 1:** `package.json` を作る。`name: "music-tag-editor"`, `version: "1.0.0"`, `description: "音楽タグエディタ"`, `main: "main.js"`, `private: true`, `license: "MIT"`。scripts: `start: "electron ."`, `test: "node --test test/"`, `dist`, `dist:win`, `dist:dir`（exif-viewer-95 と同じ）。`build` は spec §9（`appId: jp.local.musictageditor`, `productName: Music Tag Editor`, files: `main.js`, `main/**/*`, `preload.js`, `renderer/**/*`、win: nsis+portable x64、nsis: oneClick false / allowToChangeInstallationDirectory true）。mac/linux ターゲットは exif-viewer-95 と同形（linux category は `AudioVideo`, mac category は `public.app-category.music`）。
- [ ] **Step 2:** `npm i node-taglib-sharp@6.0.3` と `npm i -D electron@43.8.3 electron-builder@^26.15.3`。`.gitignore` に `node_modules/`, `dist/`。
- [ ] **Step 3:** `test/fixtures/make.sh` に生成コマンドを書き、実行して生成物をコミット対象にする:
  ```sh
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 blank.mp3
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -c:a aac blank.m4a
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 blank.flac
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -c:a libvorbis blank.ogg
  ffmpeg -y -f lavfi -i color=red:s=8x8  -frames:v 1 cover-red.png
  ffmpeg -y -f lavfi -i color=blue:s=8x8 -frames:v 1 cover-blue.jpg
  printf 'not audio' > broken.mp3
  ```
  `README.md` に「テストは ffmpeg 不要。再生成時のみ `sh make.sh`」と記載。
- [ ] **Step 4:** `npm test` が「テスト 0 件」で正常終了することを確認。
- [ ] **Step 5:** コミット `追加：プロジェクト雛形とテスト用サンプル`

### Task 2: `main/tags.js` 読み込み

**Files:**
- Create: `main/tags.js`, `test/tags.test.js`

**Interfaces:**
- Produces:
  - `FIELDS_TEXT = ['title','artist','album','albumArtist','composer','genre','comment']`
  - `FIELDS_NUM = ['year','track','trackCount','disc','discCount']`
  - `read(path: string) -> Promise<Tags>`。`Tags = { path, format: 'MP3'|'M4A'|'FLAC'|'OGG', title..comment: string, year..discCount: number, artwork: {mime, size, hash} | null }`。`hash` は SHA-1 hex。
  - `readArtwork(path) -> Promise<{mime: string, data: Uint8Array} | null>`
  - 開けないファイルは `read` が reject（Error message は日本語可）。

- [ ] **Step 1: テストを書く**（各テストは `fs.mkdtempSync(os.tmpdir())` にフィクスチャをコピーして使う。ヘルパ `copyFixture(name) -> path` をテストファイル内に置く）
  ```js
  test('read: タグ無しファイルは空の値', async () => {
    for (const ext of ['mp3','m4a','flac','ogg']) {
      const t = await read(copyFixture(`blank.${ext}`));
      assert.equal(t.format, {mp3:'MP3',m4a:'M4A',flac:'FLAC',ogg:'OGG'}[ext]);
      assert.equal(t.album, ''); assert.equal(t.year, 0); assert.equal(t.artwork, null);
    }
  });
  test('read: 壊れたファイルは reject', async () => {
    await assert.rejects(read(copyFixture('broken.mp3')));
  });
  ```
  （書き込みを伴う読み込みテストは Task 3 で `write` と往復させる。）
- [ ] **Step 2:** `npm test` → FAIL（module not found）
- [ ] **Step 3:** 実装。`File.createFromPath(p)` → `file.tag` から値を取り、必ず `finally { file.dispose() }`。複数値は `tag.performers / albumArtists / composers / genres` を `'; '` で join。`title/album/comment` の `undefined` は `''`。format は拡張子から（`.m4b/.mp4`→M4A、`.oga/.opus`→OGG）。表紙選択は `pictures.find(p => p.type === PictureType.FrontCover) ?? pictures[0]`、bytes は `pic.data.toByteArray()`、mime は `pic.mimeType`。
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** コミット `追加：タグ読み込み処理`

### Task 3: `main/tags.js` 書き込み（安全な置き換え）

**Files:**
- Modify: `main/tags.js`
- Test: `test/tags.test.js`

**Interfaces:**
- Consumes: Task 2 の `read`, `FIELDS_*`
- Produces: `write(path, patch) -> Promise<Tags>`。`patch` は `Tags` の編集キーの部分集合 + 任意の `artwork: {mime, data: Uint8Array} | null`。戻り値は書き込み後の `read(path)`。

- [ ] **Step 1: テストを書く**
  ```js
  const FULL = { title:'曲名', artist:'A; B', album:'Alb', albumArtist:'AA', composer:'C',
    genre:'Pop', comment:'1行目\n2行目', year:1999, track:3, trackCount:12, disc:1, discCount:2 };
  test('write: 全項目+アートワークの往復', async () => { /* 4形式それぞれ: write(p,{...FULL, artwork:{mime:'image/png',data:red}}) → read(p) の各キーが FULL と一致、artwork.mime==='image/png'、readArtwork(p).data が red と同一バイト */ });
  test('write: patch に無いキーは変わらない', /* FULL 書き込み後 write(p,{title:'新'}) → album==='Alb', year===1999, artwork 維持 */);
  test('write: 空文字と0で削除', /* write(p,{album:'',year:0}) → album==='', year===0 */);
  test('write: artwork:null で表紙削除', /* → artwork===null */);
  test('write: 表紙以外の画像は保持', /* 事前に taglib で FrontCover(red) + BackCover(blue) を直接設定 → write(p,{artwork:{mime:'image/jpeg',data:blue}}) → taglib で直接読み pictures.length===2、BackCover が残る、FrontCover が blue。artwork:null でも BackCover が残る */);
  test('write: 失敗時は元ファイル不変・一時ファイル無し', /* fs.chmodSync(dir, 0o555) で書き込み不可にし rejects、元ファイルのバイト列一致、readdir に '.mte-tmp' を含む名前が無い。finally で chmod 戻す。process.getuid?.()===0 なら skip */);
  test('write: 壊れたファイルは reject し不変', /* broken.mp3 */);
  ```
- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** 実装。モジュール読み込み時に `Id3v2Settings.defaultVersion = 3; Id3v2Settings.forceDefaultVersion = true`。手順は spec §5.2: `tmp = path.join(dir, '.' + base + '.mte-tmp')` に `copyFile` → taglib で patch 適用・`save()`・`dispose()` → `read(tmp)` で patch の各キーが期待値（文字列は `;` 分割正規化後の join 値）と一致するか検証 → `rename(tmp, path)`。失敗時は `rm(tmp, {force:true})` してから rethrow。文字列キーは `''` → `undefined`（title/album/comment）または `[]`（配列系）。アートワーク: 既存 `pictures` から表紙（Task 2 と同じ選択規則）を除き、`patch.artwork` が非 null なら `Picture.fromFullData(ByteVector.fromByteArray(data), PictureType.FrontCover, mime, '')` を先頭に追加。
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** コミット `追加：タグ書き込み処理`

### Task 4: `main/scan.js` パス展開

**Files:**
- Create: `main/scan.js`, `test/scan.test.js`

**Interfaces:**
- Produces: `AUDIO_EXT`（Global Constraints の拡張子、ドット無し小文字）、`expand(paths: string[]) -> Promise<{ files: string[], truncated: boolean }>`。ファイルは拡張子で絞り込み、フォルダは深さ 8 まで再帰、名前順（`localeCompare(…, 'ja', {numeric:true})`）、重複除去、ドットで始まる名前は無視、20000 件で打ち切り `truncated: true`。

- [ ] **Step 1: テストを書く** — tmp に `a/2.mp3`, `a/10.flac`, `a/cover.jpg`, `a/.x.mp3.mte-tmp`, `a/b/1.M4A` を作る。
  ```js
  test('expand: 対象拡張子のみ・自然順・再帰', async () => {
    const r = await expand([dir]);
    assert.deepEqual(r.files.map(f => path.relative(dir, f)),
      ['a/2.mp3', 'a/10.flac', 'a/b/1.M4A'].map(p => path.normalize(p)));
    assert.equal(r.truncated, false);
  });
  test('expand: ファイル直接指定と重複除去', /* expand([f, f, dir]) で f が1回 */);
  test('expand: 存在しないパスは無視', /* expand(['/nope']) → files [] */);
  ```
  （同一ディレクトリ内はファイル→サブフォルダの順に並べる。）
- [ ] **Step 2:** FAIL 確認 → **Step 3:** 実装 → **Step 4:** PASS 確認
- [ ] **Step 5:** コミット `追加：フォルダ走査処理`

### Task 5: `renderer/model.js` 選択・差分ロジック

**Files:**
- Create: `renderer/model.js`, `test/model.test.js`

**Interfaces:**
- Consumes: `Tags` の形（Task 2）
- Produces（DOM 非依存。`module.exports` があればそれに、無ければ `window.Model` に公開する UMD 形式）:
  - `MIXED = Symbol('mixed')`
  - `effective(entry) -> Tags`（`{...entry.tags, ...entry.patch}`。ただし patch.artwork は `{mime, size, hash}` だけを残して返す）
  - `merged(entries) -> { [key]: value | MIXED }`（`FIELDS_TEXT/NUM` と `artwork`。artwork は `hash` 比較、両方 null なら null）
  - `setField(entries, key, value)`: 各 entry の `patch[key] = value`。正規化後に `entry.tags[key]` と等しければ `delete patch[key]`。文字列は複数値キー（artist/albumArtist/composer/genre）なら `;` 分割→trim→空除去→`'; '` join で比較。
  - `setArtwork(entries, art | null)`: `art = {mime, data, size, hash}`。`patch.artwork = art`（null は削除）。元の hash と同じなら patch から外す。
  - `isDirty(entry) -> boolean`、`clearPatch(entries)`
  - `parseNum(str) -> number`（空/非数→0、0〜9999 に clamp）
  - `toWirePatch(entry) -> object`（IPC 送信用。artwork は `{mime, data}` のみ、null は null）

  `entry = { path, tags: Tags, patch: {}, status: 'ok'|'saving'|'error'|'unreadable', error?: string }`

- [ ] **Step 1: テストを書く**
  ```js
  test('merged: 一致は値・不一致は MIXED', /* 2件 album 同じ, title 違う → album==='X', title===MIXED */);
  test('setField: 触ったキーだけ全員の patch に入る', /* setField([e1,e2],'album','Y') → 両方 patch.album==='Y'、patch.title undefined */);
  test('setField: 元の値に戻すと dirty が消える', /* setField([e],'album','Y'); setField([e],'album', e.tags.album) → isDirty(e)===false */);
  test('setField: 複数値は正規化して比較', /* tags.artist 'A; B' に 'A;B ' を入れても dirty でない */);
  test('setArtwork: 同一 hash は dirty にしない / null で削除 patch', ...);
  test('parseNum', () => { assert.equal(parseNum(''),0); assert.equal(parseNum('12a'),0); assert.equal(parseNum('12000'),9999); assert.equal(parseNum('7'),7); });
  ```
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS
- [ ] **Step 5:** コミット `追加：複数選択と差分管理のモデル`

### Task 6: メインプロセスと preload

**Files:**
- Create: `main.js`, `preload.js`

**Interfaces:**
- Consumes: `main/tags.js`（`read`, `readArtwork`, `write`）、`main/scan.js`（`expand`）
- Produces: `window.desktop`（spec §5.3 の表をそのまま。追加の詳細）:
  - `openFiles()` / `openFolder()` → `string[] | null`（openFolder はフォルダパス1件の配列）
  - `expand(paths)` → `{files, truncated}`
  - `readTags(p)` → `{ok: true, tags} | {ok: false, error}`（reject させずに包む）。`writeTags(p, patch)` も同形。`readArtwork(p)` → `{mime, data} | null`
  - `pickImage()` → `{mime, data, name} | null`（拡張子から mime。jpg/jpeg→image/jpeg, png→image/png）
  - `saveImage(art, suggestedName)` → `boolean`
  - `reveal(p)`, `fileUrl` は不要（画像は Blob 表示）
  - `onCloseRequest(cb)`: メインが `close` を `preventDefault` して `app:close-request` を送る。レンダラーは確認後 `confirmClose()` を呼び、メインは `forceClose` フラグを立てて `win.close()`。

- [ ] **Step 1:** exif-viewer-95 の `main.js`/`preload.js` を雛形に作る（ウィンドウ 1180x760、min 860x560、`backgroundColor '#c0c0c0'`、`sandbox: false`、`Menu.setApplicationMenu(null)`、ナビゲーション禁止、DPI スイッチ）。exif 関連 IPC は除去し上記を追加。
- [ ] **Step 2:** 一時的な `renderer/index.html`（CSP 付き、`<script>` で `desktop.openFolder().then(p=>p&&desktop.expand(p)).then(r=>r&&desktop.readTags(r.files[0])).then(x=>document.body.textContent=JSON.stringify(x))`）で `npm start` し、フォルダ選択後に1曲目のタグ JSON が表示されることを確認。
- [ ] **Step 3:** コミット `追加：メインプロセスとpreload`

### Task 7: 画面の骨組みとファイル一覧

**Files:**
- Create: `renderer/index.html`, `renderer/style.css`, `renderer/app.js`

**Interfaces:**
- Consumes: `window.desktop`（Task 6）、`window.Model`（Task 5。`<script src="model.js">` を `app.js` より前に読む）

- [ ] **Step 1:** `style.css` に exif-viewer-95 の `:root` トークン、ベベル、スクロールバー、ボタン、タイトルバー、メニューバー、ツールバー、ステータスバー、ListView の規則をコピー（EXIF 固有の規則は持ち込まない）。
- [ ] **Step 2:** `index.html`: タイトルバー（タイトル `音楽タグエディタ Ver.1.0.0 － [<開いたフォルダ or ファイル数>]`、未読込時は `[ファイルが読み込まれていません]`）、メニュー（spec §4.4 の表どおり + 未実装の項目は `.dis`）、ツールバー（開く/フォルダ/保存/元に戻す）、左右分割（左 ListView・右はタブ領域の空枠）、ステータスバー。
- [ ] **Step 3:** `app.js`: 一覧の読み込み（`expand` → 並列度 4 で `readTags`、到着順に追加、読めない行は `status:'unreadable'` で灰色＋形式欄「エラー」）、列（# / タイトル / アーティスト / アルバム / 年 / 形式 / ファイル名）、ヘッダークリックのソート（初期: フォルダ → disc → track → ファイル名）、Ctrl/Shift/Ctrl+A 選択、ドラッグ&ドロップ追加（`pathForFile`、重複無視）、ステータスバー文言（`N 個のファイル / M 個を選択 / 未保存 K`、truncated 時「上限 20000 件で打ち切りました」）、dirty 行の太字、error 行の赤字＋`title` 属性。
- [ ] **Step 4:** `npm start` で手動確認: フォルダを開く → 一覧表示、ソート、複数選択、壊れたファイルがエラー行、DnD 追加。
- [ ] **Step 5:** コミット `追加：画面の骨組みとファイル一覧`

### Task 8: 詳細タブ・保存・元に戻す・終了確認

**Files:**
- Modify: `renderer/index.html`, `renderer/style.css`, `renderer/app.js`

- [ ] **Step 1:** 右ペインに Win98 プロパティシート風タブ（`詳細` / `アートワーク`）。選択タブは 2px せり上がり下辺の線を消してパネルと繋げる。Ctrl+Tab / Ctrl+Shift+Tab で切替、選択タブは選択変更でも維持。
- [ ] **Step 2:** 詳細タブのフォーム（spec §4.3 のレイアウト・アクセスキー）。選択変更時に `Model.merged` で値を入れ、`MIXED` は空欄＋placeholder `(複数の値)`。無選択/unreadable のみ選択時は全入力 disabled。`input` で `Model.setField` → 一覧行とステータスを再描画。数値欄は数字以外を `beforeinput` で拒否し `parseNum`。
- [ ] **Step 3:** 保存（Ctrl+S/ツールバー/メニュー）: dirty を順に `writeTags(path, Model.toWirePatch(e))`、ステータス `保存中… i / n`、成功で `tags` 更新・`clearPatch`、失敗で `status:'error'`。終了後に失敗があれば HTML ダイアログ「N 件のファイルを保存できませんでした。」＋ファイル名と理由の一覧。
- [ ] **Step 4:** 元に戻す（Ctrl+Z は入力欄外のみ）＝選択中の `clearPatch`。
- [ ] **Step 5:** HTML モーダル部品 `showDialog({title, message, buttons:[…]}) -> Promise<index>`（Win98 タイトルバー付き、Enter=既定、Esc=キャンセル）。未保存がある状態での終了・開く・フォルダを開くで「変更を保存しますか？」[はい][いいえ][キャンセル]。はい→保存→失敗が0件なら続行。
- [ ] **Step 6:** 手動確認（Task 10 チェックリストの詳細タブ部分）。保存後に `ffprobe -show_entries format_tags` で値を確認。
- [ ] **Step 7:** コミット `追加：詳細タブと保存処理`

### Task 9: アートワークタブ

**Files:**
- Modify: `renderer/index.html`, `renderer/style.css`, `renderer/app.js`

- [ ] **Step 1:** 枠（`.in` ベベル、flex 中央寄せ）内に `<img>`（`max-width/max-height: 100%; object-fit: contain`、元サイズより拡大しない）。下に `幅 x 高さ ピクセル / JPEG / 84 KB`（KB は 1024 で割り四捨五入、1024 KB 以上は MB 小数1桁）。空時「アートワークがありません」、不一致時「(複数のアートワーク)」（書き出し無効）。
- [ ] **Step 2:** 表示データ: `merged().artwork` が値なら、patch にあればその data、無ければ先頭選択ファイルの `readArtwork` を取得（直前と同じ hash ならキャッシュ再利用）→ `Blob` → `createObjectURL`、差し替え時に `revokeObjectURL`。
- [ ] **Step 3:** 追加: ボタン（`pickImage`）、枠へのドロップ（`pathForFile` は不要。`File.arrayBuffer()` と `file.type`）、アートワークタブ表示中の Ctrl+V（`navigator.clipboard.read()` から `image/png`）。mime が `image/jpeg|image/png` 以外は「JPEG または PNG を指定してください」、10 MB 超は確認。`hash` はレンダラーで `crypto.subtle.digest('SHA-1')` → hex。`Model.setArtwork`。
- [ ] **Step 4:** 削除＝`Model.setArtwork(sel, null)`。書き出し＝`saveImage(art, '<アルバム名 or cover>.<jpg|png>')`。
- [ ] **Step 5:** 手動確認（Task 10 チェックリストのアートワーク部分）。
- [ ] **Step 6:** コミット `追加：アートワークタブ`

### Task 10: README・ビルド・最終確認

**Files:**
- Create: `README.md`
- Create: `docs/manual-test.md`

- [ ] **Step 1:** `README.md`: 起動・テスト・ビルド手順、構成表（spec §5 の構成）、実装メモ（DPI、File.path → `webUtils`、フレームレス、CSP、一時ファイル書き込み、ID3v2.3）、既知の制限（spec §10）。
- [ ] **Step 2:** `docs/manual-test.md` チェックリスト: 4形式それぞれで詳細全項目の編集→保存→再読込で一致／複数選択で1欄だけ変更→他欄不変／(複数の値)表示／元に戻す／読み取り専用ファイルの保存失敗が赤字＋ダイアログ／アートワーク追加3経路・削除・書き出し／(複数のアートワーク)表示／未保存で終了時の確認3択／タブ切替ショートカット。
- [ ] **Step 3:** `npm test` 全 PASS、`npm run dist:dir` が成功し `dist/` 下の実行ファイルが起動すること（Linux 環境では `linux-unpacked`。Windows インストーラはユーザー環境で確認）。
- [ ] **Step 4:** コミット `追加：READMEと手動テスト手順`
