'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { read, readArtwork } = require('../main/tags');

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
