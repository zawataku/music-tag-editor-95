'use strict';

const fsp = require('fs/promises');
const path = require('path');

const AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'mp4', 'flac', 'ogg', 'oga', 'opus'];

const MAX_DEPTH = 8;
const MAX_FILES = 20000;

const byName = (a, b) => a.localeCompare(b, 'ja', { numeric: true });

/**
 * Turn a mixed list of file and directory paths into a flat list of
 * audio files. Within a directory, files come before subdirectories.
 * Dot-files are skipped, which also hides our own `.x.mte-tmp.mp3`.
 */
async function expand(paths, { maxFiles = MAX_FILES } = {}) {
  const seen = new Set();
  const files = [];
  let truncated = false;

  function add(p) {
    if (seen.has(p)) return;
    if (files.length >= maxFiles) { truncated = true; return; }
    seen.add(p);
    files.push(p);
  }

  function isAudio(name) {
    return !name.startsWith('.') &&
      AUDIO_EXT.includes(path.extname(name).slice(1).toLowerCase());
  }

  async function visit(p, depth) {
    let st;
    try { st = await fsp.stat(p); } catch { return; }

    if (st.isFile()) {
      if (isAudio(path.basename(p))) add(p);
      return;
    }
    if (!st.isDirectory() || depth > MAX_DEPTH) return;

    let entries;
    try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return; }
    entries = entries.filter((e) => !e.name.startsWith('.'));
    const names = (pred) => entries.filter(pred).map((e) => e.name).sort(byName);

    for (const name of names((e) => e.isFile())) {
      if (isAudio(name)) add(path.join(p, name));
    }
    for (const name of names((e) => e.isDirectory())) {
      if (truncated) return;
      await visit(path.join(p, name), depth + 1);
    }
  }

  for (const p of paths) {
    if (truncated) break;
    await visit(path.resolve(p), 0);
  }
  return { files, truncated };
}

module.exports = { AUDIO_EXT, expand };
