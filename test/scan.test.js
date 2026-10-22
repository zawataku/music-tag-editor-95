'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expand } = require('../main/scan');

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mte-scan-'));
  for (const f of files) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), '');
  }
  return dir;
}

test('expand: 対象拡張子のみ・自然順・再帰', async () => {
  const dir = tree(['a/2.mp3', 'a/10.flac', 'a/cover.jpg', 'a/.x.mte-tmp.mp3', 'a/b/1.M4A']);
  const r = await expand([dir]);
  assert.deepEqual(r.files.map((f) => path.relative(dir, f)),
    ['a/2.mp3', 'a/10.flac', 'a/b/1.M4A'].map((p) => path.normalize(p)));
  assert.equal(r.truncated, false);
});

test('expand: ファイル直接指定と重複除去', async () => {
  const dir = tree(['x.ogg', 'y.opus']);
  const f = path.join(dir, 'x.ogg');
  const r = await expand([f, f, dir]);
  assert.deepEqual(r.files, [f, path.join(dir, 'y.opus')]);
});

test('expand: 存在しないパスは無視', async () => {
  assert.deepEqual(await expand(['/nope/nothing']), { files: [], truncated: false });
});

test('expand: 上限で打ち切り', async () => {
  const dir = tree(['1.mp3', '2.mp3', '3.mp3']);
  const r = await expand([dir], { maxFiles: 2 });
  assert.equal(r.files.length, 2);
  assert.equal(r.truncated, true);
});
