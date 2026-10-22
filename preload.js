'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,

  // --- window controls (frameless window, HTML title bar) ---
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('win:state', (_e, v) => cb(v)),

  // --- closing with unsaved edits ---
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
  confirmClose: () => ipcRenderer.invoke('app:confirmClose'),

  // --- file selection ---
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  expand: (paths) => ipcRenderer.invoke('fs:expand', paths),

  /**
   * File.path was removed in Electron 32. This is the replacement, and it
   * only works from the preload script.
   */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || null; }
    catch { return null; }
  },

  // --- tags ---
  readTags: (p) => ipcRenderer.invoke('tags:read', p),
  writeTags: (p, patch) => ipcRenderer.invoke('tags:write', p, patch),
  readArtwork: (p) => ipcRenderer.invoke('tags:readArtwork', p),

  // --- artwork files ---
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  saveImage: (art, name) => ipcRenderer.invoke('dialog:saveImage', art, name),

  // --- misc ---
  reveal: (p) => ipcRenderer.invoke('fs:reveal', p),
  engine: () => ipcRenderer.invoke('app:engine')
});
