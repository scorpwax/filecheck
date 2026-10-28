const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

const opts = { junk: [...C.DEFAULT_JUNK, 'BSCHL', 'STUD 826'] };
const clean = (name, isDir) => C.analyze(name, opts, isDir).clean;

test('cleans names the way the team names files', () => {
  assert.strictEqual(clean('01_Roadrunner_Brand_Story_v2_261019.mp4'), 'Roadrunner_Brand_Story');
  assert.strictEqual(clean('11_HVAC_Services_(Cutdown)_Vid_Ref.mov'), 'HVAC_Services_Cutdown');
  assert.strictEqual(clean('BSCHL Key1_Audio.aaf'), 'Key_01');
  assert.strictEqual(clean('STUD_826-GillLaw-BrandStory_videoref.mov'), 'Gill_Law_Brand_Story');
});

test('version strings like v1.0 are removed whole', () => {
  assert.strictEqual(clean('06_Commercial Plumbing (Scripted) v1.0.mp4'), clean('06 Commercial Plumbing Scripted', true));
});

test('matches video names to AAF folder names', () => {
  const v = ['06_Plumbing v1.0.mp4', '07_Drain v1.0.mp4'].map((name) => ({ name }));
  const a = ['06 Plumbing', '08 Other'].map((name) => ({ name, isDir: true }));
  const r = C.compare(v, a, opts);
  assert.strictEqual(r.pairs.length, 1);
  assert.deepStrictEqual(r.missingAAF.map((f) => f.name), ['07_Drain v1.0.mp4']);
  assert.deepStrictEqual(r.missingVideo.map((f) => f.name), ['08 Other']);
});

test('copies are flagged as duplicates and the original is kept', () => {
  const v = ['10_Water v1.0.mp4', '10_Water v1.0 Copy 01.mp4'].map((name) => ({ name }));
  const a = ['10 Water', '10 Water 1'].map((name) => ({ name, isDir: true }));
  const r = C.compare(v, a, opts);
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.duplicates.video[0].dupOf, '10_Water v1.0.mp4');
  assert.strictEqual(r.duplicates.aaf[0].dupOf, '10 Water');
});

test('same number with a different title becomes a possible match', () => {
  const r = C.compare([{ name: '08_Honest Reviews.mp4' }], [{ name: '08 A Totally Retitled Thing', isDir: true }], opts);
  assert.strictEqual(r.possible.length, 1);
  assert.strictEqual(r.possible[0].byNumber, true);
});

test('repeated numbers in one folder are reported', () => {
  const r = C.compare(['37 Thank You Contacting.mp4', '37_Thank You Connect.mp4'].map((name) => ({ name })), [], opts);
  assert.strictEqual(r.numberClashes.video.length, 1);
  assert.strictEqual(r.numberClashes.video[0].num, 37);
});

test('sequencing numbers pairs and gives both sides the same name', () => {
  const r = C.compare(['06_B.mp4', '07_A.mp4'].map((name) => ({ name })), ['06 B', '07 A'].map((name) => ({ name, isDir: true })), opts);
  const seq = C.sequence(r.pairs, opts);
  assert.deepStrictEqual(seq.map((p) => p.stem), ['01_B', '02_A']);
  assert.strictEqual(seq[0].video.newBase, seq[0].aaf.newBase);
});

test('re-sequencing can start at a chosen number', () => {
  const mk = () => C.compare(['06_B.mp4', '07_A.mp4'].map((name) => ({ name })), ['06 B', '07 A'].map((name) => ({ name, isDir: true })), opts).pairs;
  assert.deepStrictEqual(C.sequence(mk(), { ...opts, startNumber: 4 }).map((p) => p.stem), ['04_B', '05_A']);
  assert.deepStrictEqual(C.sequence(mk(), { ...opts, startNumber: 99 }).map((p) => p.stem), ['099_B', '100_A']);
  assert.deepStrictEqual(C.sequence(mk(), { ...opts, startNumber: 'abc' }).map((p) => p.stem), ['01_B', '02_A']);
});
