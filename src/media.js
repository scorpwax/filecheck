// Reads video length straight from MP4/MOV headers (no ffmpeg needed), and checks AAF Media folders.
const fsp = require('fs').promises;
const path = require('path');

const MP4_EXTS = ['mov', 'mp4', 'm4v', 'qt'];

async function readBuf(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return bytesRead < len ? b.subarray(0, bytesRead) : b;
}

async function findAtom(fh, start, end, type) {
  let pos = start;
  while (pos + 8 <= end) {
    const h = await readBuf(fh, pos, 16);
    if (h.length < 8) return null;
    let size = h.readUInt32BE(0);
    const t = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1) { if (h.length < 16) return null; size = Number(h.readBigUInt64BE(8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr) return null;
    if (t === type) return { pos, size, hdr };
    pos += size;
  }
  return null;
}

async function mp4Duration(fh, size) {
  const moov = await findAtom(fh, 0, size, 'moov');
  if (!moov) return null;
  const mvhd = await findAtom(fh, moov.pos + moov.hdr, moov.pos + moov.size, 'mvhd');
  if (!mvhd) return null;
  const b = await readBuf(fh, mvhd.pos + mvhd.hdr, 32);
  const v1 = b[0] === 1;
  const timescale = v1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
  const duration = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
  return timescale ? duration / timescale : null;
}

// seconds, or null when the format isn't readable (MXF, ProRes in odd wrappers, etc.)
async function probeDuration(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const read = MP4_EXTS.includes(ext) ? mp4Duration : null;
  if (!read) return null;
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    return await read(fh, size);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Is the "AAF Media" folder inside an AAF folder present, and is it empty?
async function inspectMedia(folderPath) {
  try {
    const entries = await fsp.readdir(folderPath, { withFileTypes: true });
    const media = entries.find((d) => d.isDirectory() && /^aaf media$/i.test(d.name));
    if (!media) return { exists: false, empty: false };
    const items = (await fsp.readdir(path.join(folderPath, media.name))).filter((n) => !n.startsWith('.'));
    return { exists: true, empty: items.length === 0 };
  } catch {
    return { exists: false, empty: false };
  }
}

module.exports = { probeDuration, inspectMedia };
