const test = require("node:test");
const assert = require("node:assert/strict");
const Rv = require("../src/core/reveal.js");

test("stage: 0 before the range, 1 after it, smoothstep between", () => {
  assert.equal(Rv.stage(0, [15, 75]), 0);
  assert.equal(Rv.stage(75, [15, 75]), 1);
  assert.equal(Rv.stage(45, [15, 75]), 0.5);
  assert.equal(Rv.stage(-5, [15, 75]), 0);
  assert.equal(Rv.stage(120, [15, 75]), 1);
});

test("STAGES are the spec's Amount % ranges", () => {
  assert.deepEqual(Rv.STAGES, { border: [0, 40], lines: [15, 75], labels: [55, 85], title: [75, 100] });
});

test("spotlightDim is the max of spotlight times the border stage over the reveals", () => {
  assert.equal(Rv.spotlightDim([{ amount: 100, spotlight: 60 }, { amount: 20, spotlight: 90 }]), 60);
  assert.equal(Rv.spotlightDim([{ amount: 0, spotlight: 60 }, { amount: 20, spotlight: 90 }]), 45);
  assert.equal(Rv.spotlightDim([]), 0);
});

test("titlePosition header top-centre sits at the top middle, inset by the margin, origin at the comp centre", () => {
  assert.deepEqual(Rv.titlePosition(0, 1, 60, 1920, 1080, null, 0), [0, 480]);
});

test("titlePosition header corners: 0 top-left, 2 top-right, 3 bottom-left, 4 bottom-centre, 5 bottom-right", () => {
  assert.deepEqual(Rv.titlePosition(0, 0, 60, 1920, 1080, null, 0), [-900, 480]);
  assert.deepEqual(Rv.titlePosition(0, 2, 60, 1920, 1080, null, 0), [900, 480]);
  assert.deepEqual(Rv.titlePosition(0, 3, 60, 1920, 1080, null, 0), [-900, -480]);
  assert.deepEqual(Rv.titlePosition(0, 4, 60, 1920, 1080, null, 0), [0, -480]);
  assert.deepEqual(Rv.titlePosition(0, 5, 60, 1920, 1080, null, 0), [900, -480]);
});

test("titlePosition follows the constellation: projected point plus the offset in y", () => {
  assert.deepEqual(Rv.titlePosition(1, 1, 60, 1920, 1080, [100, 50], 80), [100, 130]);
});

test("titlePosition follows the constellation off screen when its centre is not projected", () => {
  assert.deepEqual(Rv.titlePosition(1, 1, 60, 1920, 1080, null, 80), [1e6, 1e6]);
});

test("revealTiming: a flight to this constellation starts 40% before its end and runs to the end", () => {
  const last = { start: 0, end: 100, target: { kind: "constellation", index: 5 } };
  assert.deepEqual(Rv.revealTiming(last, 5, 37, 25), { start: 60, frames: 40 });
});

test("revealTiming: otherwise it starts at the playhead for one second", () => {
  const last = { start: 0, end: 100, target: { kind: "constellation", index: 5 } };
  assert.deepEqual(Rv.revealTiming(last, 6, 37, 25), { start: 37, frames: 25 });
  assert.deepEqual(Rv.revealTiming(null, 5, 37, 25), { start: 37, frames: 25 });
});

test("revealTiming: a flight to a star does not count as this constellation", () => {
  const last = { start: 0, end: 100, target: { kind: "star", index: 5 } };
  assert.deepEqual(Rv.revealTiming(last, 5, 37, 25), { start: 37, frames: 25 });
});
