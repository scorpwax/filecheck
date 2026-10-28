// Pure logic: name cleaning, matching, numbering. Runs in Node (tests) and the renderer.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VIDEO_EXTS = ['mov', 'mp4', 'm4v', 'mxf', 'avi', 'mkv', 'mpg', 'mpeg', 'wmv', 'webm', 'prores'];
  const AAF_EXTS = ['aaf'];

  // One entry per line. Plain text = whole-word/phrase (case-insensitive).
  // Lines wrapped in /slashes/ are regular expressions tested against each word.
  const DEFAULT_JUNK = [
    '/^v\\d+$/i',
    '/^\\d{6,8}$/',
    'videoref', 'vid ref', 'vidref', 'video ref', 'video reference',
    'ref', 'vid', 'video',
    '16x9', '9x16', '1x1', '4x5',
    'for audio', 'audio',
  ];

  const DEFAULT_OPTIONS = {
    junk: DEFAULT_JUNK,
    splitCamel: true,
    numbering: 'sequence', // 'sequence' | 'keep'
    startNumber: 1,        // first number when re-sequencing
  };

  // v1, v1.0, v2.3.1 (not part of a longer word)
  const VERSION_RE = /(^|[\s_\-.(\[])v\d+(?:\.\d+)*(?=$|[\s_\-.)\]])/gi;

  const tokenize = (s) =>
    s
      .replace(/['"`‘’“”]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  function splitExt(filename) {
    const i = filename.lastIndexOf('.');
    if (i <= 0) return { base: filename, ext: '' };
    return { base: filename.slice(0, i), ext: filename.slice(i + 1) };
  }

  function leadingNumber(base) {
    const m = base.match(/^(\d{1,2})[\s_\-.]+(?=\S)/);
    return m ? { num: parseInt(m[1], 10), rest: base.slice(m[0].length) } : { num: null, rest: base };
  }

  function compileJunk(lines) {
    const regexes = [];
    const phrases = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^\/(.+)\/([a-z]*)$/);
      if (m) {
        try { regexes.push(new RegExp(m[1], m[2])); } catch (e) { /* ignore bad regex */ }
      } else {
        const t = tokenize(line.toLowerCase());
        if (t.length) phrases.push(t);
      }
    }
    phrases.sort((a, b) => b.length - a.length); // longest phrase first
    return { regexes, phrases };
  }

  function removeJunk(tokens, junk) {
    const { regexes, phrases } = junk;
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      let skip = 0;
      for (const p of phrases) {
        if (p.every((w, k) => tokens[i + k] && tokens[i + k].toLowerCase() === w)) { skip = p.length; break; }
      }
      if (skip) { i += skip - 1; continue; }
      if (regexes.some((r) => r.test(tokens[i]))) continue;
      out.push(tokens[i]);
    }
    return out;
  }

  function prettyTokens(tokens, splitCamel) {
    const out = [];
    for (const t of tokens) {
      let s = t;
      if (splitCamel) s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
      s = s.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
      for (const part of s.split(' ')) out.push(/^\d$/.test(part) ? '0' + part : part);
    }
    return out;
  }

  // filename -> { clean, key, num, ext, original }
  function analyze(filename, options, isDir) {
    const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    const junk = opts._compiled || (opts._compiled = compileJunk(opts.junk));
    const { base, ext } = isDir ? { base: filename, ext: '' } : splitExt(filename);
    const { num, rest } = leadingNumber(base);
    const noVersion = rest.replace(VERSION_RE, '$1');
    let tokens = removeJunk(tokenize(noVersion), junk);
    if (!tokens.length) tokens = tokenize(noVersion);
    // Finder / editor duplicates: "... Copy", "... copy 2", "... Copy 01"
    let copy = false;
    tokens = tokens.filter((t, i) => {
      if (/^copy$/i.test(t)) { copy = true; return false; }
      if (/^\d{1,2}$/.test(t) && i > 0 && /^copy$/i.test(tokens[i - 1])) return false;
      return true;
    });
    const pretty = prettyTokens(tokens, opts.splitCamel);
    const clean = pretty.join('_');
    const key = clean.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return { original: filename, clean, key, num, ext, copy };
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  const similar = (a, b, sameNum) => {
    if (Math.min(a.length, b.length) < 5) return false;
    if (a.startsWith(b) || b.startsWith(a)) return true;
    const d = lev(a, b), max = Math.max(a.length, b.length);
    // same leading number (e.g. both "06") earns extra tolerance
    return d <= 2 || d <= max * 0.12 || (sameNum && d <= max * 0.3);
  };

  /**
   * videos / aafs: arrays of { name, path }
   * returns { pairs, missingAAF, missingVideo, possible, duplicates, counts }
   */
  function compare(videos, aafs, options) {
    const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    opts._compiled = compileJunk(opts.junk);
    const tag = (f) => ({ ...f, ...analyze(f.name, opts, f.isDir) });
    const V = videos.map(tag), A = aafs.map(tag);

    const group = (list) => {
      // originals first, so a "Copy" never wins over the real file
      const sorted = [...list].sort((a, b) => (a.copy - b.copy) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      const map = new Map(), dups = [];
      for (const f of sorted) {
        if (map.has(f.key)) { f.dupOf = map.get(f.key).name; dups.push(f); } else map.set(f.key, f);
      }
      // Finder-style "Name 1" sitting next to "Name"
      for (const f of [...map.values()]) {
        const m = f.key.match(/^(.{5,}?)(\d{1,2})$/);
        if (m && map.has(m[1])) { f.dupOf = map.get(m[1]).name; map.delete(f.key); dups.push(f); }
      }
      return { map, dups };
    };
    const gv = group(V), ga = group(A);

    const pairs = [], missingAAF = [], missingVideo = [];
    for (const [k, v] of gv.map) {
      if (ga.map.has(k)) pairs.push({ video: v, aaf: ga.map.get(k), clean: v.clean, fuzzy: false });
      else missingAAF.push(v);
    }
    for (const [k, a] of ga.map) if (!gv.map.has(k)) missingVideo.push(a);

    // possible matches among leftovers (one-to-one, closest first)
    const possible = [];
    const usedV = new Set(), usedA = new Set();
    const cands = [];
    for (const v of missingAAF) for (const a of missingVideo) if (similar(v.key, a.key, v.num != null && v.num === a.num)) cands.push({ v, a, d: lev(v.key, a.key) });
    cands.sort((x, y) => x.d - y.d);
    for (const c of cands) {
      if (usedV.has(c.v) || usedA.has(c.a)) continue;
      usedV.add(c.v); usedA.add(c.a);
      possible.push({ video: c.v, aaf: c.a, clean: c.v.clean, fuzzy: true });
    }
    // same leading number but a different title (e.g. a re-titled video)
    for (const v of missingAAF) {
      if (usedV.has(v) || v.num == null) continue;
      let best = null;
      for (const a of missingVideo) {
        if (usedA.has(a) || a.num !== v.num) continue;
        const d = lev(v.key, a.key);
        if (!best || d < best.d) best = { a, d };
      }
      if (best) {
        usedV.add(v); usedA.add(best.a);
        possible.push({ video: v, aaf: best.a, clean: v.clean, fuzzy: true, byNumber: true });
      }
    }
    // Two different files claiming the same leading number (e.g. "37 Thank You..." and "37_Thank You Connect...")
    const clashes = (map) => {
      const by = new Map();
      for (const f of map.values()) if (f.num != null) { if (!by.has(f.num)) by.set(f.num, []); by.get(f.num).push(f); }
      return [...by].filter(([, l]) => l.length > 1).sort((a, b) => a[0] - b[0]).map(([num, files]) => ({ num, files }));
    };
    return {
      numberClashes: { video: clashes(gv.map), aaf: clashes(ga.map) },
      pairs,
      possible,
      missingAAF: missingAAF.filter((f) => !usedV.has(f)),
      missingVideo: missingVideo.filter((f) => !usedA.has(f)),
      duplicates: { video: gv.dups, aaf: ga.dups },
      counts: { video: V.length, aaf: A.length },
    };
  }

  /** Assign numbers + final names to the pairs to be renamed. Mutates and returns pairs. */
  function sequence(pairs, options) {
    const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    const sorted = [...pairs].sort((a, b) => {
      const na = a.video.num ?? a.aaf.num ?? Infinity;
      const nb = b.video.num ?? b.aaf.num ?? Infinity;
      return na !== nb ? na - nb : a.clean.localeCompare(b.clean, undefined, { numeric: true });
    });
    const parsed = parseInt(opts.startNumber, 10);
    const start = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    const last = opts.numbering === 'keep' ? sorted.length : start + sorted.length - 1;
    const width = Math.max(2, String(last).length);
    const pad = (n) => String(n).padStart(width, '0');
    if (opts.numbering === 'keep') {
      const used = new Set();
      const dupe = new Set();
      for (const p of sorted) {
        const n = p.video.num ?? p.aaf.num;
        if (n != null) { if (used.has(n)) dupe.add(p); used.add(n); }
      }
      let next = 1;
      for (const p of sorted) {
        let n = p.video.num ?? p.aaf.num;
        if (n == null || dupe.has(p)) { while (used.has(next)) next++; n = next; used.add(n); }
        p.number = pad(n);
      }
    } else {
      sorted.forEach((p, i) => { p.number = pad(start + i); });
    }
    for (const p of sorted) {
      p.stem = `${p.number}_${p.clean}`;
      p.video.newBase = p.stem;
      p.aaf.newBase = p.stem;
    }
    return sorted;
  }

  return { VIDEO_EXTS, AAF_EXTS, DEFAULT_JUNK, DEFAULT_OPTIONS, analyze, compare, sequence, splitExt };
});
