'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const tags = require('./main/tags');
const { AUDIO_EXT, expand } = require('./main/scan');

/* ------------------------------------------------------------------
   Bitmap fonts break on fractional scaling, so pin the device scale
   to 1. These switches must be set before app.whenReady().
   ------------------------------------------------------------------ */
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

let win = null;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    frame: false,               // the title bar is drawn in HTML
    icon: path.join(__dirname, 'build', 'icon.ico'),   // taskbar; made by `npm run icon`
    backgroundColor: '#c0c0c0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,           // preload needs webUtils
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  // The in-page menu bar replaces the native one entirely.
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('maximize', () => win.webContents.send('win:state', true));
  win.on('unmaximize', () => win.webContents.send('win:state', false));
  win.on('closed', () => { win = null; });

  // Unsaved edits live in the renderer, so let it decide (it calls
  // app:confirmClose once the user has answered the save prompt).
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:close-request');
  });

  // Never let the app navigate away or spawn windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

/* ==================================================================
   Window controls
   ================================================================== */
ipcMain.handle('win:minimize', () => { if (win) win.minimize(); });
ipcMain.handle('win:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:close', () => { if (win) win.close(); });
ipcMain.handle('win:isMaximized', () => (win ? win.isMaximized() : false));
ipcMain.handle('app:confirmClose', () => {
  forceClose = true;
  if (win) win.close();
});

/* ==================================================================
   File selection
   ================================================================== */
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '音楽ファイルを開く',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '音楽ファイル', extensions: AUDIO_EXT },
      { name: 'すべてのファイル', extensions: ['*'] }
    ]
  });
  return r.canceled ? null : r.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'フォルダを開く',
    properties: ['openDirectory']
  });
  return r.canceled ? null : r.filePaths;
});

ipcMain.handle('fs:expand', (_e, paths) => expand(paths));

/* ==================================================================
   Tags. Errors are returned, not thrown, so one bad file never
   surfaces as an unhandled rejection in the renderer.
   ================================================================== */
async function result(fn) {
  try {
    return { ok: true, tags: await fn() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

ipcMain.handle('tags:read', (_e, p) => result(() => tags.read(p)));
ipcMain.handle('tags:write', (_e, p, patch) => result(() => tags.write(p, patch)));
ipcMain.handle('tags:readArtwork', async (_e, p) => {
  try { return await tags.readArtwork(p); } catch { return null; }
});

/* ==================================================================
   Artwork files
   ================================================================== */
ipcMain.handle('dialog:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'アートワークを追加',
    properties: ['openFile'],
    filters: [{ name: '画像ファイル (JPEG, PNG)', extensions: Object.keys(IMAGE_MIME) }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const mime = IMAGE_MIME[path.extname(p).slice(1).toLowerCase()] || null;
  return { mime, data: new Uint8Array(await fsp.readFile(p)), name: path.basename(p) };
});

ipcMain.handle('dialog:saveImage', async (_e, art, suggestedName) => {
  const ext = art.mime === 'image/png' ? 'png' : 'jpg';
  const r = await dialog.showSaveDialog(win, {
    title: 'アートワークの書き出し',
    defaultPath: suggestedName,
    filters: [{ name: ext === 'png' ? 'PNG' : 'JPEG', extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return false;
  await fsp.writeFile(r.filePath, art.data);
  return true;
});

/* ==================================================================
   Misc
   ================================================================== */
ipcMain.handle('fs:reveal', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

ipcMain.handle('app:engine', () => ({
  taglib: require('node-taglib-sharp/package.json').version,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
}));
