'use strict';

/* ------------------------------------------------------------------
   node-taglib-sharp wrapper. Converts between taglib's Tag object and
   the flat shape the renderer works with:

     text fields : '' means unset
     num fields  : 0 means unset
     multi-value : joined with '; '
   ------------------------------------------------------------------ */

const crypto = require('crypto');
const path = require('path');
const { File, PictureType } = require('node-taglib-sharp');

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

module.exports = { FIELDS_TEXT, FIELDS_NUM, read, readArtwork };
