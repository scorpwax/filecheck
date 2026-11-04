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

test('an AAF folder named only by its number matches the video with that number', () => {
  const V = ['04_What to Expect.mp4', '05_Client Testimonial.mp4', '07_Dup A.mp4', '07_Dup B.mp4'].map((name) => ({ name }));
  const A = ['04', '05', '07', '36'].map((name) => ({ name, isDir: true }));
  const r = C.compare(V, A, opts);
  assert.deepStrictEqual(r.pairs.map((p) => p.clean), ['What_to_Expect', 'Client_Testimonial']);
  assert.ok(r.pairs.every((p) => !p.fuzzy));
  // a repeated number is ambiguous, so it stays unmatched
  assert.deepStrictEqual(r.missingAAF.map((f) => f.name), ['07_Dup A.mp4', '07_Dup B.mp4']);
  assert.deepStrictEqual(r.missingVideo.map((f) => f.name), ['07', '36']);
});

test('rename rules run in order on the cleaned name', () => {
  const r = (type, a, b) => ({ type, a, b });
  assert.strictEqual(C.applyRules('Brand_Story_Final', [r('replaceAll', 'final', ''), r('removeLast', 1)]), 'Brand_Story');
  assert.strictEqual(C.applyRules('a_b_a', [r('replaceFirst', 'a', 'X')]), 'X_b_a');
  assert.strictEqual(C.applyRules('a_b_a', [r('replaceLast', 'a', 'X')]), 'a_b_X');
  assert.strictEqual(C.applyRules('Brand_Story_V2_Final', [r('wildcard', 'V?_*', 'End')]), 'Brand_Story_End');
  assert.strictEqual(C.applyRules('04_Key', [r('regex', '^(\\d+)_(.*)$', '$2-$1')]), 'Key-04');
  assert.strictEqual(C.applyRules('Story!', [r('removeChars', '!?'), r('case', 'upper')]), 'STORY');
  assert.strictEqual(C.applyRules('hello_world', [r('case', 'title'), r('insert', 'XX', '5'), r('prepend', 'A'), r('append', '_end')]), 'AHelloXX_World_end');
  // match case is opt-in
  assert.strictEqual(C.applyRules('Story', [r('replaceAll', 'story', 'Tale')], true), 'Story');
  // a bad pattern is skipped, and a name is never emptied or given path characters
  assert.strictEqual(C.ruleError(r('regex', '(')), 'Not a valid pattern');
  assert.strictEqual(C.applyRules('Key', [r('regex', '(', '')]), 'Key');
  assert.strictEqual(C.applyRules('abc', [r('removeFirst', 3)]), 'abc');
  assert.strictEqual(C.applyRules('a', [r('prepend', 'x/y:')]), 'x_y_a');
});

test('rules change the new name but not how files are matched', () => {
  const rules = [{ type: 'replaceAll', a: 'story', b: 'Tale' }];
  const r = C.compare(['06_Brand Story.mp4'].map((name) => ({ name })), ['06 Brand Story'].map((name) => ({ name, isDir: true })), opts);
  assert.strictEqual(r.pairs.length, 1);
  assert.deepStrictEqual(C.sequence(r.pairs, { ...opts, rules }).map((p) => p.stem), ['01_Brand_Tale']);
});
