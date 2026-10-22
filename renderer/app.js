/* ============================================================
   Renderer: file list, property sheet, saving, dialogs and
   window chrome. Edit/merge rules live in model.js (window.Model).

   entry = model.js entry + { seq, folder }
     status : 'ok' | 'unreadable' (taglib could not open it)
              | 'saving' | 'error' (the last save failed)
     seq    : position in the expand() result, for the default sort
     folder : rank of the containing folder, in first-seen order
   ============================================================ */
(function () {
  'use strict';

  const D = window.desktop;
  const M = window.Model;

  const APP_NAME = '音楽タグエディタ';
  const APP_TITLE = APP_NAME + ' Ver.1.0.0';
  const READ_CONCURRENCY = 4;
  const TABS = ['detail', 'artwork'];

  const COLS = [
    { key: 'track', label: '#', num: true },
    { key: 'title', label: 'タイトル' },
    { key: 'artist', label: 'アーティスト' },
    { key: 'album', label: 'アルバム' },
    { key: 'year', label: '年', num: true },
    { key: 'format', label: '形式' },
    { key: 'name', label: 'ファイル名' }
  ];
  // the last column takes the remaining width
  const colWidths = [36, 170, 130, 150, 44, 44];

  /* ============================================================
     State
     ============================================================ */
  const files = new Map();       // path -> entry
  let order = [];                // paths in display order
  const selection = new Set();   // paths
  let anchor = null;             // start of a Shift range
  let cursor = null;             // focused row
  let sortKey = null;            // null = folder, disc, track, file name
  let sortAsc = true;
  let label = null;              // folder shown in the title, or null
  let truncated = false;
  let loadToken = 0;             // bumped when the list is replaced
  const pending = new Set();     // paths being read right now
  let seq = 0;
  const folderRank = new Map();  // dir -> rank
  let activeTab = 'detail';
  let saving = false;
  let dialogOpen = false;

  const $ = (id) => document.getElementById(id);
  const collator = new Intl.Collator('ja', { numeric: true });

  /* ============================================================
     Utilities
     ============================================================ */
  function baseName(p) {
    return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  }
  function dirName(p) {
    return p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function info(msg) { $('stInfo').textContent = msg; }
  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  /** Column values as shown, edits included. Numbers stay numbers for sorting. */
  function view(e) {
    const t = e.tags ? M.effective(e) : {};
    return {
      track: t.track || 0,
      title: t.title || '',
      artist: t.artist || '',
      album: t.album || '',
      year: t.year || 0,
      format: e.status === 'unreadable' ? 'エラー' : t.format || '',
      name: baseName(e.path)
    };
  }

  /** Selected entries that can be edited (unreadable files are skipped). */
  function editable() {
    const out = [];
    for (const p of selection) {
      const e = files.get(p);
      if (e && e.tags) out.push(e);
    }
    return out;
  }

  function dirtyCount() {
    let n = 0;
    for (const e of files.values()) if (M.isDirty(e)) n++;
    return n;
  }

  /* ============================================================
     Loading
     ============================================================ */
  function clearList() {
    files.clear();
    pending.clear();
    folderRank.clear();
    order = [];
    selection.clear();
    anchor = cursor = null;
    label = null;
    truncated = false;
  }

  /**
   * Expand `paths` and read every new file, 4 at a time, adding rows as
   * they arrive. `replace` empties the list first (open commands);
   * otherwise the files are appended and duplicates ignored (drops).
   */
  async function load(paths, replace) {
    if (!paths || !paths.length) return;
    // Opening replaces the list, so it abandons any load still running.
    // Drops only append and run alongside one another.
    const token = replace ? ++loadToken : loadToken;
    info('ファイルを検索しています…');
    const r = await D.expand(paths);
    if (token !== loadToken) return;

    const wasEmpty = replace || (files.size === 0 && pending.size === 0);
    if (replace) clearList();
    truncated = truncated || r.truncated;

    const todo = r.files.filter((p) => !files.has(p) && !pending.has(p)).map((p) => {
      const dir = dirName(p);
      if (!folderRank.has(dir)) folderRank.set(dir, folderRank.size);
      pending.add(p);
      return { path: p, seq: seq++, folder: folderRank.get(dir) };
    });
    if (replace || todo.length) {
      // a single folder names the window; anything else shows a file count
      const isFolder = paths.length === 1 && !r.files.includes(paths[0]);
      label = wasEmpty && isFolder ? paths[0] : null;
    }
    if (!todo.length) {
      renderAll();
      info(r.files.length ? '追加するファイルはありません（すべて一覧にあります）' : '対応する音楽ファイルが見つかりませんでした');
      return;
    }

    let next = 0;
    let done = 0;
    async function worker() {
      while (next < todo.length) {
        const item = todo[next++];
        const res = await D.readTags(item.path);
        if (token !== loadToken) return;
        pending.delete(item.path);
        files.set(item.path, res.ok
          ? { path: item.path, tags: res.tags, patch: {}, status: 'ok', seq: item.seq, folder: item.folder }
          : { path: item.path, tags: null, patch: {}, status: 'unreadable', error: res.error, seq: item.seq, folder: item.folder });
        order.push(item.path);
        done++;
        if (!saving) info(`読み込み中… ${done} / ${todo.length}`);
        scheduleRender();
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(READ_CONCURRENCY, todo.length); i++) workers.push(worker());
    await Promise.all(workers);
    if (token !== loadToken) return;

    if (!selection.size && order.length) {
      sortOrder();
      selection.add(order[0]);
      anchor = cursor = order[0];
    }
    renderAll(true);
    const bad = todo.filter((t) => files.get(t.path).status === 'unreadable').length;
    info(`${todo.length} 件を読み込みました` +
      (bad ? `（${bad} 件は読み込めませんでした）` : '') +
      (truncated ? ' / 上限 20000 件で打ち切りました' : ''));
  }

  // Re-rendering thousands of rows per file is too slow; batch them.
  let renderTimer = 0;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = 0; renderAll(); }, 120);
  }

  /* ============================================================
     Sorting
     ============================================================ */
  function compareDefault(a, b) {
    const ta = a.tags || {}, tb = b.tags || {};
    return a.folder - b.folder ||
      (ta.disc || 0) - (tb.disc || 0) ||
      (ta.track || 0) - (tb.track || 0) ||
      collator.compare(baseName(a.path), baseName(b.path)) ||
      a.seq - b.seq;
  }

  // Only call right before renderList(): rows are addressed by index.
  function sortOrder() {
    const num = sortKey && COLS.find((c) => c.key === sortKey).num;
    order.sort((pa, pb) => {
      const a = files.get(pa), b = files.get(pb);
      let d = 0;
      if (sortKey) {
        const x = view(a)[sortKey], y = view(b)[sortKey];
        d = num ? x - y : collator.compare(x, y);
        if (!sortAsc) d = -d;
      }
      return d || compareDefault(a, b);
    });
  }

  /* ============================================================
     Rendering: list, status, commands
     ============================================================ */
  function applyColumns() {
    $('lv').style.setProperty('--cols', colWidths.map((w) => w + 'px').join(' ') + ' minmax(80px, 1fr)');
  }

  function renderHead() {
    $('lvHead').innerHTML = COLS.map((c, i) => {
      const on = c.key === sortKey;
      return `<div data-sort="${c.key}"${on ? ` class="sorted" data-arrow="${sortAsc ? '▲' : '▼'}"` : ''}>` +
        esc(c.label) + (i < colWidths.length ? `<div class="grip" data-grip="${i}"></div>` : '') + '</div>';
    }).join('');
  }

  function rowClass(e) {
    let cls = 'row';
    if (selection.has(e.path)) cls += ' sel';
    if (e.path === cursor) cls += ' cur';
    if (e.status === 'unreadable') cls += ' unread';
    if (e.status === 'error') cls += ' err';
    if (M.isDirty(e)) cls += ' dirty';
    return cls;
  }

  function rowHtml(e, i) {
    const v = view(e);
    let html = `<div class="${rowClass(e)}" data-i="${i}"${e.error ? ` title="${esc(e.error)}"` : ''}>`;
    for (const c of COLS) {
      const val = c.num ? (v[c.key] || '') : v[c.key];
      html += `<div${c.num ? ' class="num"' : ''}>${esc(val)}</div>`;
    }
    return html + '</div>';
  }

  function renderList() {
    const body = $('lvBody');
    if (!order.length) {
      body.innerHTML = '<div class="lv-empty">音楽ファイルまたはフォルダをここへドロップしてください。<br>' +
        '対応形式: MP3 / M4A / FLAC / OGG</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < order.length; i++) html += rowHtml(files.get(order[i]), i);
    body.innerHTML = html;
  }

  /** Redraw only these rows, e.g. after an edit or a save. */
  function refreshRows(paths) {
    const rows = $('lvBody').children;
    const pos = new Map(order.map((p, i) => [p, i]));
    for (const p of paths) {
      const i = pos.get(p);
      // rows past the end are still waiting for the next batched render
      if (i !== undefined && rows[i] && rows[i].dataset.i === String(i)) rows[i].outerHTML = rowHtml(files.get(p), i);
    }
  }

  /** Cheaper than renderList when only the selection changed. */
  function renderSelection() {
    const rows = $('lvBody').children;
    for (let i = 0; i < rows.length && i < order.length; i++) {
      rows[i].className = rowClass(files.get(order[i]));
    }
  }

  function renderStatus() {
    $('stCount').textContent = `${files.size} 個のファイル / ${selection.size} 個を選択 / 未保存 ${dirtyCount()}`;
  }

  function renderTitle() {
    const what = label || (files.size ? `${files.size} 個のファイル` : 'ファイルが読み込まれていません');
    $('titleText').textContent = `${APP_TITLE} － [${what}]`;
  }

  function renderCommands() {
    const canSave = !saving && dirtyCount() > 0;
    const canUndo = !saving && editable().some(M.isDirty);
    $('miSave').classList.toggle('dis', !canSave);
    $('tbSave').disabled = !canSave;
    $('miUndo').classList.toggle('dis', !canUndo);
    $('tbUndo').disabled = !canUndo;
    $('miReveal').classList.toggle('dis', !selection.size);
    $('miSelectAll').classList.toggle('dis', !files.size);
  }

  /** `force` also rewrites the field that has focus (see renderForm). */
  function renderSheet(force) {
    renderForm(force);
    renderArtwork();
  }

  function renderAll(force) {
    sortOrder();
    renderHead();
    renderList();
    renderStatus();
    renderTitle();
    renderCommands();
    renderSheet(force);
  }

  function selectionChanged() {
    renderSelection();
    renderStatus();
    renderCommands();
    renderSheet(true);
  }

  /* ============================================================
     Selection
     ============================================================ */
  function selectRange(from, to, add) {
    if (!add) selection.clear();
    const a = order.indexOf(from), b = order.indexOf(to);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(order[i]);
  }

  function selectAll() {
    for (const p of order) selection.add(p);
    selectionChanged();
  }

  function scrollToCursor() {
    const i = order.indexOf(cursor);
    const row = $('lvBody').children[i];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  $('lvBody').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest('.row');
    if (!row) {
      // clicking below the last row clears the selection, as in Explorer
      if (!e.ctrlKey && !e.shiftKey && selection.size) { selection.clear(); selectionChanged(); }
      return;
    }
    const p = order[Number(row.dataset.i)];
    if (e.shiftKey && anchor && files.has(anchor)) {
      selectRange(anchor, p, e.ctrlKey);
    } else if (e.ctrlKey) {
      if (selection.has(p)) selection.delete(p); else selection.add(p);
      anchor = p;
    } else {
      selection.clear();
      selection.add(p);
      anchor = p;
    }
    cursor = p;
    selectionChanged();
  });

  $('lvBody').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    const moves = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10, Home: -Infinity, End: Infinity };
    if (!(e.key in moves) || !order.length) return;
    e.preventDefault();
    const cur = order.indexOf(cursor);
    const i = cur < 0 ? 0 : Math.max(0, Math.min(order.length - 1, cur + moves[e.key]));
    cursor = order[i];
    if (e.shiftKey && anchor && files.has(anchor)) {
      selectRange(anchor, cursor, false);
    } else {
      selection.clear();
      selection.add(cursor);
      anchor = cursor;
    }
    selectionChanged();
    scrollToCursor();
  });

  /* ============================================================
     Column header: sort and resize
     ============================================================ */
  $('lvHead').addEventListener('mousedown', (e) => {
    const grip = e.target.closest('.grip');
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(grip.dataset.grip);
    const startX = e.clientX, startW = colWidths[idx];
    function move(ev) { colWidths[idx] = Math.max(24, startW + ev.clientX - startX); applyColumns(); }
    function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  $('lvHead').addEventListener('click', (e) => {
    if (e.target.closest('.grip')) return;
    const cell = e.target.closest('[data-sort]');
    if (!cell) return;
    const key = cell.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = true; }
    renderAll();
    scrollToCursor();
  });

  /* ============================================================
     Property sheet tabs
     ============================================================ */
  function setTab(tab) {
    activeTab = tab;
    for (const b of $('tabstrip').children) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    $('pageDetail').classList.toggle('hidden', tab !== 'detail');
    $('pageArtwork').classList.toggle('hidden', tab !== 'artwork');
    renderArtwork();
  }

  function cycleTab(step) {
    setTab(TABS[(TABS.indexOf(activeTab) + step + TABS.length) % TABS.length]);
  }

  $('tabstrip').addEventListener('click', (e) => {
    const b = e.target.closest('.ptab');
    if (b) setTab(b.dataset.tab);
  });

  /* ============================================================
     Detail tab
     ============================================================ */
  const FIELDS = [...$('pageDetail').querySelectorAll('[data-key]')];
  const isNum = (el) => 'num' in el.dataset;

  /**
   * Fill the form from the merged selection. Unless `force`, the field
   * being typed in is left alone so its caret does not jump.
   */
  function renderForm(force) {
    const entries = editable();
    const off = saving || !entries.length;
    const m = entries.length ? M.merged(entries) : null;
    $('pageDetail').classList.toggle('dis', off);
    for (const el of FIELDS) {
      el.disabled = off;
      if (!force && el === document.activeElement) continue;
      const v = m ? m[el.dataset.key] : '';
      const mixed = v === M.MIXED;
      const text = mixed ? '' : isNum(el) ? (v ? String(v) : '') : (v || '');
      if (el.value !== text) el.value = text;
      el.placeholder = mixed ? '(複数の値)' : '';
    }
  }

  function applyField(el) {
    const entries = editable();
    if (saving || !entries.length) return;
    const key = el.dataset.key;
    M.setField(entries, key, isNum(el) ? M.parseNum(el.value) : el.value);
    // once typed into, a "(複数の値)" field holds one value for all
    el.placeholder = M.merged(entries)[key] === M.MIXED ? '(複数の値)' : '';
    refreshRows(entries.map((e) => e.path));
    renderStatus();
    renderCommands();
  }

  // Full-width digits come from the Japanese IME; accept them as digits.
  function toDigits(s) {
    return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '').slice(0, 4);
  }

  function sanitizeNum(el) {
    const s = toDigits(el.value);
    if (s !== el.value) el.value = s;
  }

  $('pageDetail').addEventListener('beforeinput', (e) => {
    if (!isNum(e.target) || e.isComposing || e.data == null) return;
    if (/[^0-9０-９]/.test(e.data)) e.preventDefault();
  });

  $('pageDetail').addEventListener('input', (e) => {
    if (!e.target.dataset.key) return;
    if (isNum(e.target)) {
      // the IME's text is only final at compositionend
      if (e.isComposing) return;
      sanitizeNum(e.target);
    }
    applyField(e.target);
  });

  $('pageDetail').addEventListener('compositionend', (e) => {
    if (!isNum(e.target)) return;
    sanitizeNum(e.target);
    applyField(e.target);
  });

  /* ============================================================
     Artwork tab
     ============================================================ */
  const ART_WARN_BYTES = 10 * 1024 * 1024;
  const ART_FORMAT = { 'image/jpeg': 'JPEG', 'image/png': 'PNG' };
  let shown = null;      // { hash, mime, data, url, state, w, h }: the last picture decoded
  let wantHash = null;   // what the frame should show now (null: a placeholder)
  let artToken = 0;

  function fmtSize(n) {
    // like Explorer, anything non-empty is at least 1 KB
    const kb = Math.max(n ? 1 : 0, Math.round(n / 1024));
    return kb >= 1024 ? (n / 1048576).toFixed(1) + ' MB' : kb + ' KB';
  }

  /** Decide the type from the bytes, not the name: tags must not lie about it. */
  function sniffImage(b) {
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    return null;
  }

  // Same digest as main/tags.js, so re-adding the cover a file already has is no change.
  async function sha1Hex(data) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
    return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function artPlaceholder(text) {
    $('artImg').classList.add('hidden');
    $('artPh').textContent = text;
    $('artPh').classList.remove('hidden');
    $('artInfo').textContent = '';
  }

  function artShow() {
    $('artPh').classList.add('hidden');
    $('artImg').classList.remove('hidden');
    $('artInfo').textContent = (shown.w ? `${shown.w} x ${shown.h} ピクセル / ` : '') +
      `${ART_FORMAT[shown.mime] || shown.mime} / ${fmtSize(shown.data.length)}`;
  }

  function setShown(hash, art) {
    if (shown) URL.revokeObjectURL(shown.url);
    shown = {
      hash, mime: art.mime, data: art.data, state: 'loading', w: 0, h: 0,
      url: URL.createObjectURL(new Blob([art.data], { type: art.mime }))
    };
    const img = $('artImg');
    const mine = shown;
    // the selection may want something else by the time it decodes
    const current = () => shown === mine && wantHash === mine.hash;
    img.onload = () => {
      mine.state = 'ok';
      mine.w = img.naturalWidth;
      mine.h = img.naturalHeight;
      if (current()) artShow();
    };
    img.onerror = () => {
      mine.state = 'error';
      if (current()) artPlaceholder('画像を表示できません');
    };
    img.src = shown.url;
  }

  /** The merged artwork of the selection, or MIXED / null. */
  function selectedArtwork(entries) {
    return entries.length ? M.merged(entries).artwork : null;
  }

  // Only drawn while the tab is visible: reading a cover means copying it over IPC.
  async function renderArtwork() {
    if (activeTab !== 'artwork') return;
    const entries = editable();
    const off = saving || !entries.length;
    const art = selectedArtwork(entries);
    $('pageArtwork').classList.toggle('dis', off);
    $('artFrame').classList.toggle('dis', off);
    $('btnArtAdd').disabled = off;
    $('btnArtDel').disabled = off || !art;
    $('btnArtSave').disabled = off || !art || art === M.MIXED;

    // any read still in flight is for an older selection
    const token = ++artToken;
    wantHash = art && art !== M.MIXED ? art.hash : null;
    if (!art || art === M.MIXED) {
      artPlaceholder(art === M.MIXED ? '(複数のアートワーク)' : 'アートワークがありません');
      return;
    }
    if (shown && shown.hash === art.hash) {
      if (shown.state === 'ok') artShow();
      else if (shown.state === 'error') artPlaceholder('画像を表示できません');
      return;    // 'loading': onload will show it
    }

    artPlaceholder('読み込み中…');
    // an unsaved cover is only in a patch; a saved one has to come from the file
    const edited = entries.find((e) => e.patch.artwork && e.patch.artwork.hash === art.hash);
    const data = edited ? edited.patch.artwork : await D.readArtwork(entries[0].path);
    if (token !== artToken) return;
    if (!data) { artPlaceholder('アートワークを読み込めませんでした'); return; }
    setShown(art.hash, data);
  }

  function artworkEdited(entries) {
    refreshRows(entries.map((e) => e.path));
    renderStatus();
    renderCommands();
    renderArtwork();
  }

  /** Validate an image and make it the cover of every selected file. */
  async function addArtwork(data) {
    const entries = editable();
    if (saving || !entries.length) return;
    const mime = sniffImage(data);
    if (!mime) {
      await showDialog({ icon: 'error', message: 'JPEG または PNG を指定してください。' });
      return;
    }
    if (data.length > ART_WARN_BYTES) {
      const i = await showDialog({
        icon: 'question',
        message: `画像のサイズが 10 MB を超えています（${fmtSize(data.length)}）。\nこのまま追加しますか？`,
        buttons: ['はい(Y)', 'いいえ(N)']
      });
      if (i !== 0) return;
    }
    M.setArtwork(entries, { mime, data, size: data.length, hash: await sha1Hex(data) });
    artworkEdited(entries);
    const changed = entries.filter((e) => 'artwork' in e.patch).length;
    info(changed ? `${changed} 件のファイルにアートワークを設定しました` : '選択中のファイルと同じアートワークです');
  }

  async function cmdAddArtwork() {
    const pick = await D.pickImage();
    if (pick) addArtwork(pick.data);
  }

  function cmdDeleteArtwork() {
    const entries = editable();
    if (saving || !entries.length || !selectedArtwork(entries)) return;
    M.setArtwork(entries, null);
    artworkEdited(entries);
  }

  async function cmdExportArtwork() {
    const entries = editable();
    const art = selectedArtwork(entries);
    if (!art || art === M.MIXED || !shown || shown.hash !== art.hash) return;
    const album = M.merged(entries).album;
    const base = typeof album === 'string' && album.trim() ? album.trim() : 'cover';
    const name = base.replace(/[\\/:*?"<>|]/g, '_') + (shown.mime === 'image/png' ? '.png' : '.jpg');
    if (await D.saveImage({ mime: shown.mime, data: shown.data }, name)) info('アートワークを書き出しました');
  }

  $('btnArtAdd').onclick = cmdAddArtwork;
  $('btnArtDel').onclick = cmdDeleteArtwork;
  $('btnArtSave').onclick = cmdExportArtwork;
  $('artFrame').addEventListener('keydown', (e) => {
    if (e.key === 'Delete') { e.preventDefault(); cmdDeleteArtwork(); }
  });

  // Ctrl+V while the tab is showing. The paste event needs no clipboard
  // permission; Chromium hands over a bitmap from the clipboard as PNG.
  document.addEventListener('paste', async (e) => {
    if (activeTab !== 'artwork' || dialogOpen || isTextField(e.target)) return;
    e.preventDefault();
    if (saving || !editable().length) return;
    const item = [...e.clipboardData.items].find((x) => x.kind === 'file' && x.type.startsWith('image/'));
    if (!item) { info('クリップボードに画像がありません'); return; }
    addArtwork(new Uint8Array(await item.getAsFile().arrayBuffer()));
  });

  /* ============================================================
     Save / undo
     ============================================================ */

  /** Write every dirty file, one at a time. Resolves to the failure count. */
  async function saveAll() {
    if (saving) return 0;
    const targets = order.map((p) => files.get(p)).filter(M.isDirty);
    if (!targets.length) return 0;

    saving = true;
    renderCommands();
    renderSheet(true);
    const failed = [];
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      info(`保存中… ${i + 1} / ${targets.length}`);
      e.status = 'saving';
      const res = await D.writeTags(e.path, M.toWirePatch(e));
      if (res.ok) {
        e.tags = res.tags;
        M.clearPatch([e]);
        e.status = 'ok';
        delete e.error;
      } else {
        e.status = 'error';
        e.error = res.error;
        failed.push(e);
      }
      refreshRows([e.path]);
    }
    saving = false;
    renderStatus();
    renderCommands();
    renderSheet(true);

    const ok = targets.length - failed.length;
    info(failed.length ? `${ok} 件を保存しました（${failed.length} 件は失敗）` : `${ok} 件を保存しました`);
    if (failed.length) {
      await showDialog({
        title: APP_NAME,
        icon: 'error',
        message: `${failed.length} 件のファイルを保存できませんでした。`,
        details: failed.map((e) => `${baseName(e.path)}: ${e.error}`)
      });
    }
    return failed.length;
  }

  function cmdUndo() {
    const entries = editable().filter(M.isDirty);
    if (saving || !entries.length) return;
    M.clearPatch(entries);
    // a failed save is moot once its edits are gone
    for (const e of entries) if (e.status === 'error') { e.status = 'ok'; delete e.error; }
    refreshRows(entries.map((e) => e.path));
    renderStatus();
    renderCommands();
    renderSheet(true);
    info(`${entries.length} 件の変更を元に戻しました`);
  }

  /**
   * Before the list is replaced or the app quits: offer to save.
   * Resolves true when it is fine to go on.
   */
  async function confirmDiscard() {
    if (saving || dialogOpen) return false;
    if (!dirtyCount()) return true;
    const i = await showDialog({
      title: APP_NAME,
      icon: 'question',
      message: '変更を保存しますか？',
      buttons: ['はい(Y)', 'いいえ(N)', 'キャンセル']
    });
    if (i === 0) return (await saveAll()) === 0;
    return i === 1;
  }

  /* ============================================================
     Dialogs (HTML, Win98 message box style)
     ============================================================ */
  const ICONS = {
    question: '<circle cx="16" cy="16" r="14" fill="#fff" stroke="#000"/>' +
      '<path d="M11.5 12a4.5 4.5 0 1 1 5.4 4.4c-1 .3-.9 1.4-.9 2.6" fill="none" stroke="#0000ff" stroke-width="3"/>' +
      '<rect x="14.4" y="21.5" width="3.2" height="3.2" fill="#0000ff"/>',
    error: '<circle cx="16" cy="16" r="14" fill="#ff0000" stroke="#800000"/>' +
      '<path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#fff" stroke-width="3.5"/>',
    info: '<circle cx="16" cy="16" r="14" fill="#fff" stroke="#000"/>' +
      '<rect x="14" y="7" width="4" height="4" fill="#0000ff"/><path d="M12 13h6v10h2v2h-8v-2h2v-8h-2z" fill="#0000ff"/>'
  };
  const GLYPH_X = '<svg width="8" height="8" shape-rendering="crispEdges"><path d="M0 0h2v1h1v1h2V1h1V0h2v1H7v1H6v1H5v2h1v1h1v1h1v1H6V7H5V6H3v1H2v1H0V7h1V6h1V5h1V3H2V2H1V1H0z" fill="#000"/></svg>';

  /**
   * showDialog({ title, message | html, details?, icon?, buttons?, onOpen? })
   *   -> Promise<index of the button pressed>
   * Enter presses the focused button (the first one by default), Esc and
   * the title bar's close button press the last one. A "(Y)" in a label
   * makes Y (or Alt+Y) press that button.
   */
  function showDialog(opts) {
    const buttons = opts.buttons || ['OK'];
    const cancel = buttons.length - 1;
    dialogOpen = true;
    const prevFocus = document.activeElement;

    const mask = document.createElement('div');
    mask.className = 'mask show';
    mask.innerHTML =
      '<div class="dlg" role="dialog"><div class="titlebar"><div class="txt"></div>' +
      `<div class="tbtns"><button class="tbtn" data-x title="閉じる">${GLYPH_X}</button></div></div>` +
      '<div class="content"><div class="msg">' +
      (opts.icon ? `<svg width="32" height="32" viewBox="0 0 32 32">${ICONS[opts.icon]}</svg>` : '') +
      '<div class="text"></div></div></div><div class="actions"></div></div>';
    mask.querySelector('.titlebar .txt').textContent = opts.title || APP_NAME;
    const text = mask.querySelector('.text');
    if (opts.html) text.innerHTML = opts.html; else text.textContent = opts.message;
    if (opts.details && opts.details.length) {
      const box = document.createElement('div');
      box.className = 'details';
      for (const line of opts.details) box.appendChild(document.createElement('div')).textContent = line;
      text.appendChild(box);
    }
    const accel = {};
    const btns = buttons.map((lbl, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      const m = /^(.*)\((\w)\)$/.exec(lbl);
      b.innerHTML = '<span class="lbl">' + (m ? `${esc(m[1])}(<u>${esc(m[2])}</u>)` : esc(lbl)) + '</span>';
      if (m) accel[m[2].toLowerCase()] = i;
      b.onclick = () => close(i);
      return mask.querySelector('.actions').appendChild(b);
    });
    mask.querySelector('[data-x]').onclick = () => close(cancel);

    let resolve;
    function close(i) {
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      dialogOpen = false;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(i);
    }
    // Capture phase, so the app's own shortcuts never see these keys.
    function onKey(e) {
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { e.preventDefault(); close(cancel); }
      else if (e.key === 'Enter') { e.preventDefault(); close(Math.max(0, btns.indexOf(document.activeElement))); }
      else if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const back = e.shiftKey || e.key === 'ArrowLeft';
        const i = btns.indexOf(document.activeElement);
        btns[(i + (back ? -1 : 1) + btns.length) % btns.length].focus();
      } else if (k in accel && !e.ctrlKey) { e.preventDefault(); close(accel[k]); }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(mask);
    btns[0].focus();
    if (opts.onOpen) opts.onOpen(mask);
    return new Promise((r) => { resolve = r; });
  }

  function showAbout() {
    showDialog({
      title: 'バージョン情報',
      icon: 'info',
      html: `<b>${APP_NAME}</b><br>Version 1.0.0<br><br>` +
        'MP3 / M4A / FLAC / OGG のタグとアートワークを編集します。<br>' +
        'タグの読み書きには node-taglib-sharp を使用しています。<br><br>' +
        '<span data-engine>確認中…</span>',
      onOpen: (dlg) => {
        D.engine().then((v) => {
          dlg.querySelector('[data-engine]').innerHTML = 'node-taglib-sharp ' + esc(v.taglib) +
            ' / Electron ' + esc(v.electron) + '<br>Chromium ' + esc(v.chrome) + ' / Node ' + esc(v.node);
        });
      }
    });
  }

  /* ============================================================
     Drag & drop: onto the artwork frame sets the cover,
     anywhere else adds to the list
     ============================================================ */
  function onArtFrame(e) {
    return activeTab === 'artwork' && !!e.target.closest && !!e.target.closest('#artFrame');
  }
  function clearDropMarks() {
    $('lv').classList.remove('drop');
    $('artFrame').classList.remove('drop');
  }
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const art = onArtFrame(e);
    $('lv').classList.toggle('drop', !art);
    $('artFrame').classList.toggle('drop', art);
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) clearDropMarks();
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearDropMarks();
    if (dialogOpen) return;
    if (onArtFrame(e)) {
      const f = e.dataTransfer.files[0];
      if (f) addArtwork(new Uint8Array(await f.arrayBuffer()));
      return;
    }
    const paths = [];
    for (const f of e.dataTransfer.files) {
      const p = D.pathForFile(f);
      if (p) paths.push(p);
    }
    load(paths, false);
  });

  /* ============================================================
     Commands
     ============================================================ */
  async function cmdOpenFiles() {
    if (await confirmDiscard()) load(await D.openFiles(), true);
  }
  async function cmdOpenFolder() {
    if (await confirmDiscard()) load(await D.openFolder(), true);
  }
  function cmdReveal() {
    const p = order.find((x) => selection.has(x));
    if (p) D.reveal(p);
  }

  $('tbOpen').onclick = cmdOpenFiles;
  $('tbDir').onclick = cmdOpenFolder;
  $('tbSave').onclick = saveAll;
  $('tbUndo').onclick = cmdUndo;

  /* ---- menus ---- */
  const menus = document.querySelectorAll('[data-menu]');
  function closeMenus() { for (const m of menus) m.classList.remove('open'); }
  function anyMenuOpen() { return [...menus].some((m) => m.classList.contains('open')); }
  for (const m of menus) {
    m.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      const was = m.classList.contains('open');
      closeMenus();
      if (!was) m.classList.add('open');
    });
    m.addEventListener('mouseenter', () => {
      if (anyMenuOpen()) { closeMenus(); m.classList.add('open'); }
    });
  }
  document.addEventListener('click', closeMenus);
  $('menubar').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (!item || item.classList.contains('dis')) return;
    closeMenus();
    const act = item.dataset.act;
    if (act === 'open') cmdOpenFiles();
    else if (act === 'openDir') cmdOpenFolder();
    else if (act === 'save') saveAll();
    else if (act === 'reveal') cmdReveal();
    else if (act === 'quit') D.close();
    else if (act === 'undo') cmdUndo();
    else if (act === 'selectAll') { selectAll(); $('lvBody').focus(); }
    else if (act === 'tabDetail') setTab('detail');
    else if (act === 'tabArtwork') setTab('artwork');
    else if (act === 'about') showAbout();
  });

  /* ---- keyboard ---- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenus(); return; }
    const k = e.key.toLowerCase();
    if (e.altKey && !e.ctrlKey) {
      if (!/^[a-z]$/.test(k)) return;
      // access keys on the visible page first, then the menu bar
      const page = activeTab === 'detail' ? $('pageDetail') : $('pageArtwork');
      const target = page.querySelector(`[data-access="${k}"]:not(:disabled)`);
      const menu = document.querySelector(`[data-menu="${k}"]`);
      // as in Windows, a button's access key presses it; a field's focuses it
      if (target && target.tagName === 'BUTTON') { e.preventDefault(); target.click(); }
      else if (target) { e.preventDefault(); target.focus(); if (target.select) target.select(); }
      else if (menu) { e.preventDefault(); closeMenus(); menu.classList.add('open'); }
      return;
    }
    if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
    if (!e.ctrlKey || e.altKey) return;
    if (k === 'o') { e.preventDefault(); cmdOpenFiles(); }
    else if (k === 'd') { e.preventDefault(); cmdOpenFolder(); }
    else if (k === 's') { e.preventDefault(); saveAll(); }
    else if (k === 'z' && !isTextField(document.activeElement)) { e.preventDefault(); cmdUndo(); }
  });

  /* ---- splitter ---- */
  $('split').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pane = $('paneRight');
    const startX = e.clientX, startW = pane.getBoundingClientRect().width;
    function move(ev) { pane.style.width = Math.min(640, Math.max(300, startW - (ev.clientX - startX))) + 'px'; }
    function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  /* ---- window controls (frameless) ---- */
  const GLYPH_MAX = '<svg width="9" height="9" shape-rendering="crispEdges"><path d="M0 0h9v2H0zM0 2h1v7H0zM8 2h1v7H8zM0 8h9v1H0z" fill="#000"/></svg>';
  const GLYPH_RESTORE = '<svg width="9" height="9" shape-rendering="crispEdges"><path d="M3 0h6v2H3zM3 2h1v1H3zM8 2h1v4H8zM4 5h5v1H4z" fill="#000"/><path d="M0 3h6v2H0zM0 5h1v4H0zM5 5h1v4H5zM0 8h6v1H0z" fill="#000"/></svg>';

  $('btnMin').onclick = () => D.minimize();
  $('btnMax').onclick = () => D.maximize();
  $('btnClose').onclick = () => D.close();
  D.onMaximizeChange((on) => {
    $('btnMax').innerHTML = on ? GLYPH_RESTORE : GLYPH_MAX;
    $('btnMax').title = on ? '元のサイズに戻す' : '最大化';
  });
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
    if (!e.target.closest('.tbtns')) D.maximize();
  });

  // The main process holds every close until we say so.
  D.onCloseRequest(async () => {
    if (await confirmDiscard()) D.confirmClose();
  });

  applyColumns();
  renderAll(true);
})();
