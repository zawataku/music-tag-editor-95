/* ============================================================
   Selection / pending-edit model. No DOM here, so it runs under
   `node --test` as well as in the renderer (as window.Model).

   entry = { path, tags, patch, status, error? }
     tags  : what is on disk (main/tags.js read() shape)
     patch : unsaved edits, only keys that differ from tags
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(this, function () {
  'use strict';

  const FIELDS_TEXT = ['title', 'artist', 'album', 'albumArtist', 'composer', 'genre', 'comment'];
  const FIELDS_NUM = ['year', 'track', 'trackCount', 'disc', 'discCount'];
  const MULTI = ['artist', 'albumArtist', 'composer', 'genre'];
  const MIXED = Symbol('mixed');

  function normalize(key, value) {
    if (MULTI.includes(key)) {
      return String(value).split(';').map((x) => x.trim()).filter(Boolean).join('; ');
    }
    return value;
  }

  function artMeta(art) {
    return art ? { mime: art.mime, size: art.size, hash: art.hash } : null;
  }

  function effective(entry) {
    const out = Object.assign({}, entry.tags, entry.patch);
    if ('artwork' in entry.patch) out.artwork = artMeta(entry.patch.artwork);
    return out;
  }

  function same(key, a, b) {
    if (key === 'artwork') return (a ? a.hash : null) === (b ? b.hash : null);
    return a === b;
  }

  function merged(entries) {
    const views = entries.map(effective);
    const out = {};
    for (const key of FIELDS_TEXT.concat(FIELDS_NUM, ['artwork'])) {
      const first = views.length ? views[0][key] : undefined;
      out[key] = views.every((v) => same(key, v[key], first)) ? first : MIXED;
    }
    return out;
  }

  function setField(entries, key, value) {
    for (const e of entries) {
      if (same(key, normalize(key, value), normalize(key, e.tags[key]))) delete e.patch[key];
      else e.patch[key] = value;
    }
  }

  function setArtwork(entries, art) {
    for (const e of entries) {
      if (same('artwork', art, e.tags.artwork)) delete e.patch.artwork;
      else e.patch.artwork = art;
    }
  }

  function isDirty(entry) {
    return Object.keys(entry.patch).length > 0;
  }

  function clearPatch(entries) {
    for (const e of entries) e.patch = {};
  }

  function parseNum(str) {
    const s = String(str).trim();
    if (!/^\d+$/.test(s)) return 0;
    return Math.min(9999, parseInt(s, 10));
  }

  function toWirePatch(entry) {
    const out = Object.assign({}, entry.patch);
    if ('artwork' in out && out.artwork) out.artwork = { mime: out.artwork.mime, data: out.artwork.data };
    return out;
  }

  return {
    FIELDS_TEXT, FIELDS_NUM, MULTI, MIXED,
    effective, merged, setField, setArtwork, isDirty, clearPatch, parseNum, toWirePatch
  };
});
