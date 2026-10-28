const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { probeDuration, inspectMedia } = require('./media');
const { aafDuration } = require('./aaf');
const { checkForUpdates, RELEASE_URL_PREFIX } = require('./updater');

const COPY_DIR = 'Renamed';
const lastRunFile = () => path.join(app.getPath('userData'), 'last-run.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'FileCheck',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // look for a newer release now, then every few hours while the app stays open
  win.webContents.once('did-finish-load', () => {
    const check = async () => {
      const info = await checkForUpdates();
      if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
    };
    check();
    const timer = setInterval(check, 4 * 60 * 60 * 1000);
    win.on('closed', () => clearInterval(timer));
  });
}

app.whenReady().then(() => {
  // dev runs (npm start) would otherwise show the Electron icon in the Dock
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(path.join(__dirname, '../build/icon.png'));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

const exists = (p) => fsp.access(p).then(() => true, () => false);
const isAaf = (n) => n.toLowerCase().endsWith('.aaf');

// run fn over items with at most `limit` in flight, keeping the original order
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

ipcMain.handle('pick-folder', async (e, title) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title, properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

async function resolveDir(p) {
  const st = await fsp.stat(p);
  return st.isDirectory() ? p : path.dirname(p);
}

ipcMain.handle('scan', async (_e, p, kind) => {
  const dir = await resolveDir(p);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }));
  if (kind === 'video') await mapLimit(files, 8, async (f) => { f.duration = await probeDuration(f.path); });
  if (kind === 'aaf') await mapLimit(files.filter((f) => isAaf(f.name)), 8, async (f) => { f.duration = await aafDuration(f.path); });
  const dirCount = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== COPY_DIR).length;
  return { dir, files, dirCount };
});

// Separated AAF export: each subfolder holds one .aaf plus an "AAF Media" folder.
ipcMain.handle('scan-separated', async (_e, p) => {
  const dir = await resolveDir(p);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const subdirs = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== COPY_DIR);
  const folders = await mapLimit(subdirs, 8, async (d) => {
    const folderPath = path.join(dir, d.name);
    const inner = (await fsp.readdir(folderPath, { withFileTypes: true }))
      .filter((f) => f.isFile() && !f.name.startsWith('.') && isAaf(f.name))
      .map((f) => f.name)
      .sort();
    const [media, duration] = await Promise.all([
      inspectMedia(folderPath),
      inner[0] ? aafDuration(path.join(folderPath, inner[0])) : null,
    ]);
    return {
      mediaEmpty: media.empty,
      duration,
      name: d.name,
      path: folderPath,
      isDir: true,
      aafName: inner[0] || null,
      aafPath: inner[0] ? path.join(folderPath, inner[0]) : null,
      aafCount: inner.length,
    };
  });
  const looseAafs = entries.filter((d) => d.isFile() && isAaf(d.name)).length;
  return { dir, folders, looseAafs };
});

// items: [{ from, newName, inner? }]; mode: 'overwrite' | 'copy'
// An item with `inner` is an AAF folder: `from`/`newName` rename the folder, and
// inner = { fromName, newName } renames the .aaf inside it so it keeps matching the folder.
ipcMain.handle('apply', async (_e, { mode, items }) => {
  const results = [];
  const log = { mode, when: new Date().toISOString(), ops: [] };

  if (mode === 'overwrite') {
    const sources = new Set(items.map((i) => i.from));
    const planned = [];
    const targets = new Set();
    for (const it of items) {
      const dir = path.dirname(it.from);
      const to = path.join(dir, it.newName);
      const innerChanges = it.inner && it.inner.fromName !== it.inner.newName;
      if (to === it.from && !innerChanges) { results.push({ from: it.from, to, ok: true, note: 'already named' }); continue; }
      if (targets.has(to)) { results.push({ from: it.from, to, ok: false, error: 'duplicate target name' }); continue; }
      if (to !== it.from && (await exists(to)) && !sources.has(to)) { results.push({ from: it.from, to, ok: false, error: 'a file with that name already exists' }); continue; }
      if (innerChanges) {
        const innerTo = path.join(it.from, it.inner.newName);
        const sameFile = it.inner.fromName.toLowerCase() === it.inner.newName.toLowerCase();
        if (!sameFile && (await exists(innerTo))) { results.push({ from: it.from, to, ok: false, error: `${it.inner.newName} already exists inside the folder` }); continue; }
      }
      targets.add(to);
      planned.push({ ...it, to, tmp: path.join(dir, `.filecheck_${process.pid}_${planned.length}.tmp`) });
    }
    const renameInner = (folder, a, b) => fsp.rename(path.join(folder, a), path.join(folder, b));
    // two phases so swaps / case-only renames can't collide
    const staged = [];
    for (const p of planned) {
      const innerChanges = p.inner && p.inner.fromName !== p.inner.newName;
      try {
        if (innerChanges) await renameInner(p.from, p.inner.fromName, p.inner.newName);
        try { await fsp.rename(p.from, p.tmp); }
        catch (err) { if (innerChanges) await renameInner(p.from, p.inner.newName, p.inner.fromName).catch(() => {}); throw err; }
        staged.push({ ...p, innerChanges });
      } catch (err) { results.push({ from: p.from, to: p.to, ok: false, error: err.message }); }
    }
    for (const p of staged) {
      try {
        await fsp.rename(p.tmp, p.to);
        results.push({ from: p.from, to: p.to, ok: true });
        log.ops.push({ from: p.from, to: p.to, inner: p.innerChanges ? p.inner : undefined });
      } catch (err) {
        await fsp.rename(p.tmp, p.from).catch(() => {});
        if (p.innerChanges) await renameInner(p.from, p.inner.newName, p.inner.fromName).catch(() => {});
        results.push({ from: p.from, to: p.to, ok: false, error: err.message });
      }
    }
  } else {
    for (const it of items) {
      const outDir = path.join(path.dirname(it.from), COPY_DIR);
      const to = path.join(outDir, it.newName);
      try {
        await fsp.mkdir(outDir, { recursive: true });
        if (await exists(to)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        if (it.inner) {
          // clone on APFS is instant and takes no extra space; falls back to a normal copy
          try {
            await fsp.cp(it.from, to, { recursive: true, errorOnExist: true, force: false, mode: fs.constants.COPYFILE_FICLONE });
            if (it.inner.fromName !== it.inner.newName) await fsp.rename(path.join(to, it.inner.fromName), path.join(to, it.inner.newName));
          } catch (err) {
            await fsp.rm(to, { recursive: true, force: true });
            throw err;
          }
        } else {
          await fsp.copyFile(it.from, to, fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL);
        }
        results.push({ from: it.from, to, ok: true });
        log.ops.push({ from: it.from, to });
      } catch (err) {
        results.push({ from: it.from, to, ok: false, error: err.code === 'EEXIST' ? 'already exists in Renamed folder' : err.message });
      }
    }
  }
  if (log.ops.length) await fsp.writeFile(lastRunFile(), JSON.stringify(log, null, 2));
  return results;
});

ipcMain.handle('undo-info', async () => {
  try { const l = JSON.parse(await fsp.readFile(lastRunFile(), 'utf8')); return { mode: l.mode, count: l.ops.length, when: l.when }; }
  catch { return null; }
});

ipcMain.handle('undo', async () => {
  let log;
  try { log = JSON.parse(await fsp.readFile(lastRunFile(), 'utf8')); } catch { return { ok: 0, failed: 0 }; }
  let ok = 0, failed = 0;
  if (log.mode === 'overwrite') {
    const staged = [];
    for (const [i, op] of log.ops.entries()) {
      const tmp = path.join(path.dirname(op.to), `.filecheck_undo_${i}.tmp`);
      try { await fsp.rename(op.to, tmp); staged.push({ ...op, tmp }); } catch { failed++; }
    }
    for (const op of staged) {
      try {
        await fsp.rename(op.tmp, op.from);
        if (op.inner) await fsp.rename(path.join(op.from, op.inner.newName), path.join(op.from, op.inner.fromName));
        ok++;
      } catch { failed++; await fsp.rename(op.tmp, op.to).catch(() => {}); }
    }
  } else {
    for (const op of log.ops) {
      try { await shell.trashItem(op.to); ok++; } catch { failed++; }
    }
  }
  if (!failed) await fsp.unlink(lastRunFile()).catch(() => {});
  return { ok, failed };
});

ipcMain.handle('save-report', async (e, { defaultName, content }) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: defaultName });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, content, 'utf8');
  return r.filePath;
});

// Moves items to the Trash (recoverable) after a native warning. Folders go with everything inside.
ipcMain.handle('trash', async (e, { paths }) => {
  const names = paths.map((p) => path.basename(p));
  const shown = names.slice(0, 15).join('\n') + (names.length > 15 ? `\n...and ${names.length - 15} more` : '');
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'warning',
    buttons: ['Cancel', 'Move to Trash'],
    defaultId: 0,
    cancelId: 0,
    title: 'Delete files',
    message: `Delete ${paths.length} item${paths.length === 1 ? '' : 's'} from disk?`,
    detail: `${shown}\n\nThese are removed from their folders. AAF folders are removed with everything inside them, including AAF Media. Items go to the Trash, so you can restore them from there until it is emptied.`,
  });
  if (r.response !== 1) return { cancelled: true };
  const results = [];
  for (const p of paths) {
    try { await shell.trashItem(p); results.push({ path: p, ok: true }); }
    catch (err) { results.push({ path: p, ok: false, error: err.message }); }
  }
  return { results };
});

// Watches the loaded folders and tells the window when something changes (debounced).
const watchers = [];
ipcMain.handle('watch', (e, { dirs }) => {
  for (const w of watchers.splice(0)) { try { w.close(); } catch { /* already closed */ } }
  const sender = e.sender;
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!sender.isDestroyed()) sender.send('folder-changed'); }, 900);
  };
  for (const { dir, recursive } of dirs) {
    try {
      watchers.push(fs.watch(dir, { recursive }, (_ev, name) => {
        if (name && name.split(path.sep).some((part) => part.startsWith('.'))) return;
        fire();
      }));
    } catch { /* folder gone or not watchable */ }
  }
});

ipcMain.handle('copy-text', async (_e, text) => { await clipboard.writeText(String(text)); });

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('check-updates', () => checkForUpdates());
// only ever open this project's own GitHub release pages / downloads
ipcMain.handle('open-release', (_e, url) => {
  if (typeof url === 'string' && url.startsWith(RELEASE_URL_PREFIX)) shell.openExternal(url);
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
