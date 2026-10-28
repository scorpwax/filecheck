// Renders build/icon-source.webp (or icon.svg if absent) to build/icon.icns. Run: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SIZES = [16, 32, 64, 128, 256, 512, 1024];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const set = path.join(__dirname, 'icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const src = fs.existsSync(path.join(__dirname, 'icon-source.webp'))
    ? `<img src="data:image/webp;base64,${fs.readFileSync(path.join(__dirname, 'icon-source.webp')).toString('base64')}" style="width:100%;height:100%">`
    : svg.replace('width="1024" height="1024"', 'width="100%" height="100%"');
  const html = `<body style="margin:0;background:transparent;display:grid;place-items:center;height:100vh"><div style="width:80.5%;height:80.5%">${src}</div></body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  const write = (px, name) => fs.writeFileSync(path.join(set, name), img.resize({ width: px, height: px, quality: 'best' }).toPNG());
  for (const s of SIZES) { if (s <= 512) write(s, `icon_${s}x${s}.png`); }
  for (const s of [16, 32, 128, 256, 512]) write(s * 2, `icon_${s}x${s}@2x.png`);
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(__dirname, 'icon.icns')]);
  fs.rmSync(set, { recursive: true, force: true });
  app.exit(0);
});
