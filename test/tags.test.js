'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { File, Picture, PictureType, ByteVector } = require('node-taglib-sharp');
const { read, readArtwork, write } = require('../main/tags');

const FIXTURES = path.join(__dirname, 'fixtures');
const EXTS = ['mp3', 'm4a', 'flac', 'ogg'];
const FORMAT = { mp3: 'MP3', m4a: 'M4A', flac: 'FLAC', ogg: 'OGG' };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mte-'));
}

function copyFixture(name, dir = tmpDir()) {
  const p = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, name), p);
  return p;
}

test('read: タグ無しファイルは空の値', async () => {
  for (const ext of EXTS) {
    const t = await read(copyFixture(`blank.${ext}`));
    assert.equal(t.format, FORMAT[ext]);
    assert.equal(t.album, '');
    assert.equal(t.artist, '');
    assert.equal(t.year, 0);
    assert.equal(t.track, 0);
    assert.equal(t.artwork, null);
  }
});

test('read: 壊れたファイルは reject', async () => {
  await assert.rejects(read(copyFixture('broken.mp3')));
});

test('readArtwork: アートワーク無しは null', async () => {
  assert.equal(await readArtwork(copyFixture('blank.flac')), null);
});

const RED = fs.readFileSync(path.join(FIXTURES, 'cover-red.png'));
const BLUE = fs.readFileSync(path.join(FIXTURES, 'cover-blue.jpg'));
const FULL = {
  title: '曲名', artist: 'A; B', album: 'Alb', albumArtist: 'AA', composer: 'C',
  genre: 'Pop', comment: '1行目\n2行目', year: 1999, track: 3, trackCount: 12, disc: 1, discCount: 2
};

function pick(t) {
  const o = {};
  for (const k of Object.keys(FULL)) o[k] = t[k];
  return o;
}

test('write: 全項目+アートワークの往復', async () => {
  for (const ext of EXTS) {
    const p = copyFixture(`blank.${ext}`);
    const ret = await write(p, { ...FULL, artwork: { mime: 'image/png', data: new Uint8Array(RED) } });
    assert.deepEqual(pick(ret), FULL, ext);
    const t = await read(p);
    assert.deepEqual(pick(t), FULL, ext);
    assert.equal(t.artwork.mime, 'image/png');
    const art = await readArtwork(p);
    assert.deepEqual(Buffer.from(art.data), RED, ext);
  }
});

test('write: patch に無いキーは変わらない', async () => {
  for (const ext of EXTS) {
    const p = copyFixture(`blank.${ext}`);
    await write(p, { ...FULL, artwork: { mime: 'image/png', data: new Uint8Array(RED) } });
    await write(p, { title: '新' });
    const t = await read(p);
    assert.equal(t.title, '新');
    assert.equal(t.album, 'Alb');
    assert.equal(t.year, 1999);
    assert.notEqual(t.artwork, null);
  }
});

test('write: 空文字と0で削除', async () => {
  for (const ext of EXTS) {
    const p = copyFixture(`blank.${ext}`);
    await write(p, FULL);
    await write(p, { album: '', artist: '', year: 0, track: 0 });
    const t = await read(p);
    assert.equal(t.album, '');
    assert.equal(t.artist, '');
    assert.equal(t.year, 0);
    assert.equal(t.track, 0);
    assert.equal(t.title, '曲名');
  }
});

test('write: 複数値は ; 区切りを正規化', async () => {
  const p = copyFixture('blank.flac');
  const t = await write(p, { artist: ' A ;B;; ' });
  assert.equal(t.artist, 'A; B');
});

test('write: artwork:null で表紙削除', async () => {
  for (const ext of EXTS) {
    const p = copyFixture(`blank.${ext}`);
    await write(p, { artwork: { mime: 'image/png', data: new Uint8Array(RED) } });
    await write(p, { artwork: null });
    assert.equal((await read(p)).artwork, null);
  }
});

function setPicturesDirect(p, pics) {
  const f = File.createFromPath(p);
  f.tag.pictures = pics.map(([bytes, type, mime]) =>
    Picture.fromFullData(ByteVector.fromByteArray(bytes), type, mime, ''));
  f.save();
  f.dispose();
}

function picturesDirect(p) {
  const f = File.createFromPath(p);
  const out = f.tag.pictures.map((x) => ({ type: x.type, mime: x.mimeType }));
  f.dispose();
  return out;
}

test('write: 表紙以外の画像は保持', async () => {
  for (const ext of ['mp3', 'flac']) {
    const p = copyFixture(`blank.${ext}`);
    setPicturesDirect(p, [[RED, PictureType.FrontCover, 'image/png'], [RED, PictureType.BackCover, 'image/png']]);
    await write(p, { artwork: { mime: 'image/jpeg', data: new Uint8Array(BLUE) } });
    let pics = picturesDirect(p);
    assert.equal(pics.length, 2, ext);
    assert.deepEqual(pics.find((x) => x.type === PictureType.FrontCover), { type: PictureType.FrontCover, mime: 'image/jpeg' });
    assert.ok(pics.some((x) => x.type === PictureType.BackCover));
    await write(p, { artwork: null });
    pics = picturesDirect(p);
    assert.deepEqual(pics, [{ type: PictureType.BackCover, mime: 'image/png' }], ext);
  }
});

test('write: 失敗時は元ファイル不変・一時ファイル無し', { skip: process.getuid && process.getuid() === 0 }, async () => {
  const dir = tmpDir();
  const p = copyFixture('blank.mp3', dir);
  const before = fs.readFileSync(p);
  // Windows ignores directory permissions, so make the file itself read-only there.
  const locked = process.platform === 'win32' ? p : dir;
  fs.chmodSync(locked, 0o555);
  try {
    await assert.rejects(write(p, { title: 'x' }));
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.deepEqual(fs.readFileSync(p), before);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.mte-tmp')), []);
});

test('write: 壊れたファイルは reject し不変・一時ファイル無し', async () => {
  const dir = tmpDir();
  const p = copyFixture('broken.mp3', dir);
  await assert.rejects(write(p, { title: 'x' }));
  assert.equal(fs.readFileSync(p, 'utf8'), 'not audio');
  assert.deepEqual(fs.readdirSync(dir), ['broken.mp3']);
});
