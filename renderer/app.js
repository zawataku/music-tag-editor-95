/* ============================================================
   Renderer: file list, selection, menus and window chrome.
   Edit/merge rules live in model.js (window.Model).

   entry = model.js entry + { seq, folder }
     status : 'ok' | 'unreadable' (taglib could not open it)
              | 'error' (the last save failed)
     seq    : position in the expand() result, for the default sort
     folder : rank of the containing folder, in first-seen order
   ============================================================ */
(function () {
  'use strict';

  const D = window.desktop;
  const M = window.Model;

  const APP_TITLE = '音楽タグエディタ Ver.1.0.0';
  const READ_CONCURRENCY = 4;

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
        info(`読み込み中… ${done} / ${todo.length}`);
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
    renderAll();
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
     Rendering
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

  function renderList() {
    const body = $('lvBody');
    if (!order.length) {
      body.innerHTML = '<div class="lv-empty">音楽ファイルまたはフォルダをここへドロップしてください。<br>' +
        '対応形式: MP3 / M4A / FLAC / OGG</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < order.length; i++) {
      const e = files.get(order[i]);
      const v = view(e);
      html += `<div class="${rowClass(e)}" data-i="${i}"${e.error ? ` title="${esc(e.error)}"` : ''}>`;
      for (const c of COLS) {
        const val = c.num ? (v[c.key] || '') : v[c.key];
        html += `<div${c.num ? ' class="num"' : ''}>${esc(val)}</div>`;
      }
      html += '</div>';
    }
    body.innerHTML = html;
  }

  /** Cheaper than renderList when only the selection changed. */
  function renderSelection() {
    const rows = $('lvBody').children;
    for (let i = 0; i < rows.length && i < order.length; i++) {
      rows[i].className = rowClass(files.get(order[i]));
    }
  }

  function renderStatus() {
    let dirty = 0;
    for (const e of files.values()) if (M.isDirty(e)) dirty++;
    $('stCount').textContent = `${files.size} 個のファイル / ${selection.size} 個を選択 / 未保存 ${dirty}`;
  }

  function renderTitle() {
    const what = label || (files.size ? `${files.size} 個のファイル` : 'ファイルが読み込まれていません');
    $('titleText').textContent = `${APP_TITLE} － [${what}]`;
  }

  function renderCommands() {
    $('miReveal').classList.toggle('dis', !selection.size);
    $('miSelectAll').classList.toggle('dis', !files.size);
  }

  function renderAll() {
    sortOrder();
    renderHead();
    renderList();
    renderStatus();
    renderTitle();
    renderCommands();
  }

  function selectionChanged() {
    renderSelection();
    renderStatus();
    renderCommands();
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
     Drag & drop: add to the list
     ============================================================ */
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    $('lv').classList.add('drop');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) $('lv').classList.remove('drop');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('lv').classList.remove('drop');
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
    load(await D.openFiles(), true);
  }
  async function cmdOpenFolder() {
    load(await D.openFolder(), true);
  }
  function cmdReveal() {
    const p = order.find((x) => selection.has(x));
    if (p) D.reveal(p);
  }

  $('tbOpen').onclick = cmdOpenFiles;
  $('tbDir').onclick = cmdOpenFolder;

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
    else if (act === 'reveal') cmdReveal();
    else if (act === 'quit') D.close();
    else if (act === 'selectAll') { selectAll(); $('lvBody').focus(); }
    else if (act === 'about') showAbout();
  });

  /* ---- about dialog ---- */
  function showAbout() {
    const el = $('aboutEngine');
    el.textContent = '確認中…';
    $('mask').classList.add('show');
    D.engine().then((v) => {
      el.innerHTML = 'node-taglib-sharp ' + esc(v.taglib) + ' / Electron ' + esc(v.electron) +
        '<br>Chromium ' + esc(v.chrome) + ' / Node ' + esc(v.node);
    });
  }
  $('mask').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === $('mask')) $('mask').classList.remove('show');
  });

  /* ---- keyboard ---- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('mask').classList.remove('show'); closeMenus(); return; }
    if (e.altKey && !e.ctrlKey) {
      const m = document.querySelector(`[data-menu="${e.key.toLowerCase()}"]`);
      if (m) { e.preventDefault(); closeMenus(); m.classList.add('open'); }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); cmdOpenFiles(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); cmdOpenFolder(); }
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

  // Nothing can be edited yet, so closing never needs a prompt.
  D.onCloseRequest(() => D.confirmClose());

  applyColumns();
  renderAll();
})();
