'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/model');

function tags(over = {}) {
  return {
    path: '/x', format: 'MP3',
    title: 'T', artist: 'A; B', album: 'X', albumArtist: '', composer: '', genre: '', comment: '',
    year: 2000, track: 1, trackCount: 0, disc: 0, discCount: 0,
    artwork: null,
    ...over
  };
}

function entry(over) {
  return { path: '/x', tags: tags(over), patch: {}, status: 'ok' };
}

const ART = { mime: 'image/png', data: new Uint8Array([1, 2, 3]), size: 3, hash: 'h1' };

test('merged: 一致は値・不一致は MIXED', () => {
  const m = M.merged([entry({ title: 'a' }), entry({ title: 'b' })]);
  assert.equal(m.album, 'X');
  assert.equal(m.title, M.MIXED);
  assert.equal(m.year, 2000);
  assert.equal(m.artwork, null);
});

test('merged: patch を反映する', () => {
  const e = entry();
  M.setField([e], 'album', 'Y');
  assert.equal(M.merged([e]).album, 'Y');
});

test('merged: artwork は hash で比較', () => {
  const a = entry({ artwork: { mime: 'image/png', size: 3, hash: 'h1' } });
  const b = entry({ artwork: { mime: 'image/png', size: 3, hash: 'h1' } });
  const c = entry({ artwork: { mime: 'image/png', size: 3, hash: 'h2' } });
  assert.equal(M.merged([a, b]).artwork.hash, 'h1');
  assert.equal(M.merged([a, c]).artwork, M.MIXED);
  assert.equal(M.merged([a, entry()]).artwork, M.MIXED);
});

test('setField: 触ったキーだけ全員の patch に入る', () => {
  const e1 = entry({ title: 'a' });
  const e2 = entry({ title: 'b' });
  M.setField([e1, e2], 'album', 'Y');
  assert.deepEqual(e1.patch, { album: 'Y' });
  assert.deepEqual(e2.patch, { album: 'Y' });
});

test('setField: 元の値に戻すと dirty が消える', () => {
  const e = entry();
  M.setField([e], 'album', 'Y');
  assert.equal(M.isDirty(e), true);
  M.setField([e], 'album', 'X');
  assert.equal(M.isDirty(e), false);
});

test('setField: 複数値は正規化して比較', () => {
  const e = entry();
  M.setField([e], 'artist', 'A;B ');
  assert.equal(M.isDirty(e), false);
});

test('setArtwork: 同一 hash は dirty にしない / null で削除 patch', () => {
  const e = entry({ artwork: { mime: 'image/png', size: 3, hash: 'h1' } });
  M.setArtwork([e], ART);
  assert.equal(M.isDirty(e), false);
  M.setArtwork([e], null);
  assert.equal(e.patch.artwork, null);
  assert.equal(M.merged([e]).artwork, null);
  const bare = entry();
  M.setArtwork([bare], null);
  assert.equal(M.isDirty(bare), false);
});

test('effective: patch.artwork はメタ情報だけ返す', () => {
  const e = entry();
  M.setArtwork([e], ART);
  assert.deepEqual(M.effective(e).artwork, { mime: 'image/png', size: 3, hash: 'h1' });
});

test('toWirePatch: artwork は mime と data のみ', () => {
  const e = entry();
  M.setField([e], 'title', 'N');
  M.setArtwork([e], ART);
  assert.deepEqual(M.toWirePatch(e), { title: 'N', artwork: { mime: 'image/png', data: ART.data } });
});

test('clearPatch', () => {
  const e = entry();
  M.setField([e], 'title', 'N');
  M.clearPatch([e]);
  assert.equal(M.isDirty(e), false);
});

test('parseNum', () => {
  assert.equal(M.parseNum(''), 0);
  assert.equal(M.parseNum('12a'), 0);
  assert.equal(M.parseNum('12000'), 9999);
  assert.equal(M.parseNum('7'), 7);
});
