// Reads the timeline length (seconds) of an .aaf straight from the file, no AAF SDK needed.
// An AAF is a Microsoft compound file (OLE storage). Objects are storages named "<Property>-<pid>",
// with vector items as "<Property>-<pid>{n}" and each object's values in a "properties" stream.
const fsp = require('fs').promises;

const ENDOFCHAIN = 0xfffffffe;
const FREE = 0xffffffff;

// well-known AAF property ids
const PID = { length: 0x0202, editRate: 0x4b01 };
// class id of CompositionMob, as stored in the directory entry (mixed-endian GUID bytes)
const COMPOSITION_MOB = '0d010101-0101-3500-060e-2b3402060101';

const guid = (b) => {
  const h = (buf) => buf.toString('hex');
  const d1 = Buffer.from(b.subarray(0, 4)).reverse(), d2 = Buffer.from(b.subarray(4, 6)).reverse(), d3 = Buffer.from(b.subarray(6, 8)).reverse();
  return `${h(d1)}-${h(d2)}-${h(d3)}-${h(b.subarray(8, 10))}-${h(b.subarray(10, 16))}`;
};

class Compound {
  constructor(fh) { this.fh = fh; }

  async read(pos, len) {
    const b = Buffer.alloc(len);
    const { bytesRead } = await this.fh.read(b, 0, len, pos);
    return bytesRead < len ? b.subarray(0, bytesRead) : b;
  }

  async load() {
    const h = await this.read(0, 512);
    if (h.length < 512 || h.toString('hex', 0, 8) !== 'd0cf11e0a1b11ae1') throw new Error('not a compound file');
    this.ssz = 1 << h.readUInt16LE(30);
    this.mssz = 1 << h.readUInt16LE(32);
    this.cutoff = h.readUInt32LE(56);
    const numFat = h.readUInt32LE(44), dirStart = h.readUInt32LE(48);
    const miniStart = h.readUInt32LE(60), numMini = h.readUInt32LE(64);
    let difat = h.readUInt32LE(68);
    const numDifat = h.readUInt32LE(72);

    const fatSectors = [];
    for (let i = 0; i < 109; i++) { const s = h.readUInt32LE(76 + i * 4); if (s !== FREE) fatSectors.push(s); }
    for (let i = 0; i < numDifat && difat !== ENDOFCHAIN && difat !== FREE; i++) {
      const sec = await this.sector(difat);
      const per = this.ssz / 4 - 1;
      for (let j = 0; j < per; j++) { const s = sec.readUInt32LE(j * 4); if (s !== FREE) fatSectors.push(s); }
      difat = sec.readUInt32LE(per * 4);
    }
    this.fat = await this.readSectors(fatSectors.slice(0, numFat || undefined));

    // directory
    const dir = await this.chain(dirStart);
    this.entries = [];
    this.dirBuf = dir;
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nameLen = dir.readUInt16LE(o + 64);
      this.entries.push({
        name: nameLen > 2 ? dir.toString('utf16le', o, o + nameLen - 2) : '',
        type: dir[o + 66],
        left: dir.readUInt32LE(o + 68), right: dir.readUInt32LE(o + 72), child: dir.readUInt32LE(o + 76),
        clsOffset: o + 80,
        start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120),
      });
    }
    this.root = this.entries[0];

    // mini stream (small streams live inside it)
    if (numMini && miniStart !== ENDOFCHAIN) {
      this.miniFat = await this.chain(miniStart);
      this.miniStream = (await this.chain(this.root.start)).subarray(0, this.root.size);
    }
  }

  async sector(sid) { return this.read((sid + 1) * this.ssz, this.ssz); }

  // follow the FAT in memory, then read each run of neighbouring sectors in one go
  async chain(start) {
    const sids = [];
    let sid = start, guard = 0;
    while (sid !== ENDOFCHAIN && sid !== FREE && guard++ < 5_000_000) {
      sids.push(sid);
      if ((sid + 1) * 4 > this.fat.length) break;
      sid = this.fat.readUInt32LE(sid * 4);
    }
    return this.readSectors(sids);
  }

  async readSectors(sids) {
    const out = Buffer.alloc(sids.length * this.ssz);
    for (let i = 0; i < sids.length;) {
      let j = i;
      while (j + 1 < sids.length && sids[j + 1] === sids[j] + 1) j++;
      const run = await this.read((sids[i] + 1) * this.ssz, (j - i + 1) * this.ssz);
      run.copy(out, i * this.ssz);
      i = j + 1;
    }
    return out;
  }

  async stream(e) {
    if (e.size < this.cutoff && this.miniFat) {
      const parts = [];
      let sid = e.start, guard = 0;
      while (sid !== ENDOFCHAIN && sid !== FREE && guard++ < 1_000_000) {
        parts.push(this.miniStream.subarray(sid * this.mssz, (sid + 1) * this.mssz));
        if ((sid + 1) * 4 > this.miniFat.length) break;
        sid = this.miniFat.readUInt32LE(sid * 4);
      }
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return (await this.chain(e.start)).subarray(0, e.size);
  }

  children(e) {
    const out = [];
    const stack = [];
    let id = e.child;
    while (stack.length || id !== FREE) {
      while (id !== FREE && id < this.entries.length) { stack.push(id); id = this.entries[id].left; }
      if (!stack.length) break;
      const cur = stack.pop();
      out.push(this.entries[cur]);
      id = this.entries[cur].right;
    }
    return out;
  }

  clsid(e) { return guid(this.dirBuf.subarray(e.clsOffset, e.clsOffset + 16)); }

  find(e, name) { return this.children(e).find((c) => c.name === name) || null; }
  all(e, prefix) { return this.children(e).filter((c) => c.name.startsWith(prefix)); }

  // property values of an object storage, keyed by pid
  async props(e) {
    const p = this.find(e, 'properties');
    if (!p) return {};
    const b = await this.stream(p);
    if (b.length < 4) return {};
    const count = b.readUInt16LE(2);
    let data = 4 + count * 6;
    const out = {};
    for (let i = 0; i < count; i++) {
      const pid = b.readUInt16LE(4 + i * 6), len = b.readUInt16LE(4 + i * 6 + 4);
      out[pid] = b.subarray(data, data + len);
      data += len;
    }
    return out;
  }
}

const TRANSITION = '0d010101-0101-1700-060e-2b3402060101';
const lengthOf = async (cf, e) => {
  const b = (await cf.props(e))[PID.length];
  return b && b.length >= 8 ? Number(b.readBigInt64LE(0)) : 0;
};

// A segment normally carries its own Length; if it's missing or zero, add up its components
// (transitions overlap their neighbours, so they don't add time).
async function segmentLength(cf, segment) {
  const own = await lengthOf(cf, segment);
  if (own > 0) return own;
  let sum = 0;
  for (const c of cf.all(segment, 'Components-1001{')) {
    if (cf.clsid(c) !== TRANSITION) sum += await lengthOf(cf, c);
  }
  return sum;
}

// seconds, or null if the file isn't a readable AAF / has no composition timeline
async function aafDuration(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const cf = new Compound(fh);
    await cf.load();
    const header = cf.find(cf.root, 'Header-2');
    const content = header && cf.find(header, 'Content-3b03');
    if (!content) return null;

    let best = null;
    for (const mob of cf.all(content, 'Mobs-1901{')) {
      if (cf.clsid(mob) !== COMPOSITION_MOB) continue;
      for (const slot of cf.all(mob, 'Slots-4403{')) {
        const sp = await cf.props(slot);
        const rate = sp[PID.editRate];
        const segment = cf.find(slot, 'Segment-4803');
        if (!rate || rate.length < 8 || !segment) continue; // not a timeline slot
        const num = rate.readInt32LE(0), den = rate.readInt32LE(4);
        if (!num || !den) continue;
        const frames = await segmentLength(cf, segment);
        const sec = (frames * den) / num;
        if (sec > 0 && (best == null || sec > best)) best = sec;
      }
    }
    return best;
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { aafDuration };
