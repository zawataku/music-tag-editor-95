'use strict';

/* ------------------------------------------------------------------
   node-taglib-sharp wrapper. Converts between taglib's Tag object and
   the flat shape the renderer works with:

     text fields : '' means unset
     num fields  : 0 means unset
     multi-value : joined with '; '
   ------------------------------------------------------------------ */

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { File, Picture, PictureType, ByteVector, Id3v2Settings } = require('node-taglib-sharp');

// Windows Explorer does not read ID3v2.4, so always save as v2.3.
Id3v2Settings.defaultVersion = 3;
Id3v2Settings.forceDefaultVersion = true;

const FIELDS_TEXT = ['title', 'artist', 'album', 'albumArtist', 'composer', 'genre', 'comment'];
const FIELDS_NUM = ['year', 'track', 'trackCount', 'disc', 'discCount'];

// renderer key -> taglib array property
const MULTI = {
  artist: 'performers',
  albumArtist: 'albumArtists',
  composer: 'composers',
  genre: 'genres'
};

const FORMAT_BY_EXT = {
  mp3: 'MP3',
  m4a: 'M4A', m4b: 'M4A', mp4: 'M4A',
  flac: 'FLAC',
  ogg: 'OGG', oga: 'OGG', opus: 'OGG'
};

function formatOf(p) {
  return FORMAT_BY_EXT[path.extname(p).slice(1).toLowerCase()] || null;
}

// Throws on unknown or corrupt files (e.g. "MPEG audio header not found").
function open(p) {
  return File.createFromPath(p);
}

/** The picture we treat as "the artwork": FrontCover, else the first. */
function coverIndex(pictures) {
  const i = pictures.findIndex((p) => p.type === PictureType.FrontCover);
  return i >= 0 ? i : (pictures.length ? 0 : -1);
}

function pictureBytes(pic) {
  return pic.data.toByteArray();
}

function sha1(bytes) {
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

function tagToObject(p, tag) {
  const out = { path: p, format: formatOf(p) };
  for (const key of FIELDS_TEXT) {
    out[key] = MULTI[key] ? (tag[MULTI[key]] || []).join('; ') : (tag[key] || '');
  }
  for (const key of FIELDS_NUM) out[key] = tag[key] || 0;

  const pics = tag.pictures || [];
  const i = coverIndex(pics);
  if (i < 0) {
    out.artwork = null;
  } else {
    const bytes = pictureBytes(pics[i]);
    out.artwork = { mime: pics[i].mimeType, size: bytes.length, hash: sha1(bytes) };
  }
  return out;
}

async function read(p) {
  const file = open(p);
  try {
    return tagToObject(p, file.tag);
  } finally {
    file.dispose();
  }
}

async function readArtwork(p) {
  const file = open(p);
  try {
    const pics = file.tag.pictures || [];
    const i = coverIndex(pics);
    return i < 0 ? null : { mime: pics[i].mimeType, data: pictureBytes(pics[i]) };
  } finally {
    file.dispose();
  }
}

/** ' A ;B;; ' -> ['A', 'B'] */
function splitMulti(s) {
  return String(s).split(';').map((x) => x.trim()).filter(Boolean);
}

function applyPatch(tag, patch) {
  for (const key of FIELDS_TEXT) {
    if (!(key in patch)) continue;
    if (MULTI[key]) tag[MULTI[key]] = splitMulti(patch[key]);
    else tag[key] = patch[key] === '' ? undefined : patch[key];
  }
  for (const key of FIELDS_NUM) {
    if (key in patch) tag[key] = patch[key] || 0;
  }
  if ('artwork' in patch) {
    const pics = (tag.pictures || []).slice();
    const i = coverIndex(pics);
    if (i >= 0) pics.splice(i, 1);
    if (patch.artwork) {
      const { mime, data } = patch.artwork;
      pics.unshift(Picture.fromFullData(ByteVector.fromByteArray(data), PictureType.FrontCover, mime, ''));
    }
    tag.pictures = pics;
  }
}

function coverHash(pictures) {
  const i = coverIndex(pictures || []);
  return i < 0 ? null : sha1(pictureBytes(pictures[i]));
}

/** What read() should return for each patched key after a successful save.
    `artworkHash` is the cover as computed from the patched tag: deleting the
    FrontCover can promote another picture to "the artwork". */
function verify(result, patch, artworkHash) {
  for (const key of FIELDS_TEXT) {
    if (!(key in patch)) continue;
    const want = MULTI[key] ? splitMulti(patch[key]).join('; ') : patch[key];
    if (result[key] !== want) throw new Error(`書き込み後の検証に失敗しました（${key}）`);
  }
  for (const key of FIELDS_NUM) {
    if (key in patch && result[key] !== (patch[key] || 0)) {
      throw new Error(`書き込み後の検証に失敗しました（${key}）`);
    }
  }
  if ('artwork' in patch) {
    if ((result.artwork ? result.artwork.hash : null) !== artworkHash) {
      throw new Error('書き込み後の検証に失敗しました（artwork）');
    }
  }
}

/**
 * taglib rewrites files in place, so work on a copy next to the original
 * (same volume, so rename is atomic) and swap it in only once it reads
 * back correctly. The copy keeps the real extension because taglib picks
 * the format from it.
 */
async function write(p, patch) {
  const ext = path.extname(p);
  const tmp = path.join(path.dirname(p), `.${path.basename(p, ext)}.mte-tmp${ext}`);
  try {
    await fsp.copyFile(p, tmp);
    const file = open(tmp);
    let artworkHash;
    try {
      applyPatch(file.tag, patch);
      artworkHash = coverHash(file.tag.pictures);
      file.save();
    } finally {
      file.dispose();
    }
    verify(await read(tmp), patch, artworkHash);
    await fsp.rename(tmp, p);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return read(p);
}

module.exports = { FIELDS_TEXT, FIELDS_NUM, read, readArtwork, write };
