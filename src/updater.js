// Checks GitHub Releases for a newer version (same approach as Conduit).
const { app, net } = require('electron');

const REPO = 'scorpwax/filecheck';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_URL_PREFIX = `https://github.com/${REPO}/`;

const semverGt = (a, b) => {
  const parse = (v) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a), [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', headers: { 'User-Agent': `FileCheck/${app.getVersion()}` } });
    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// { version, downloadUrl, releaseUrl, releaseNotes } when a newer release exists, else null
async function checkForUpdates() {
  try {
    const data = await fetchJson(API_URL);
    if (!data || typeof data !== 'object') return null;
    const remote = String(data.tag_name || '').replace(/^v/, '');
    if (!remote || !semverGt(remote, app.getVersion())) return null;
    const asset = (data.assets || []).find((a) => a.name && a.name.endsWith('.dmg'));
    const releaseUrl = data.html_url || `https://github.com/${REPO}/releases/latest`;
    return {
      version: remote,
      downloadUrl: (asset && asset.browser_download_url) || releaseUrl,
      releaseUrl,
      releaseNotes: String(data.body || '').split('\n').slice(0, 5).join(' ').trim(),
    };
  } catch {
    return null;
  }
}

module.exports = { checkForUpdates, RELEASE_URL_PREFIX };
