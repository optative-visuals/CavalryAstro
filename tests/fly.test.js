const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/core/fly.js");
const S = require("../src/core/sky.js");
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const finite = (p) => p.every((q) => Number.isFinite(q.ra) && Number.isFinite(q.dec) && Number.isFinite(q.fov));

const orion = { ra: 83.8, dec: -5.4, fov: 30 }, andromeda = { ra: 10.7, dec: 41.3, fov: 30 };

test("easing, arc and drift tables are exact", () => {
  assert.deepEqual(F.EASINGS, [
    { id: "smooth", name: "Smooth" }, { id: "gentle", name: "Gentle" },
    { id: "snappy", name: "Snappy" }, { id: "overshoot", name: "Overshoot" }]);
  assert.deepEqual(F.ARCS, [
    { id: "low", name: "Low", rho: 1.0 }, { id: "normal", name: "Normal", rho: Math.SQRT2 },
    { id: "high", name: "High", rho: 2.0 }]);
  assert.deepEqual(F.DRIFTS, [
    { id: "in", name: "Push in" }, { id: "out", name: "Pull out" }, { id: "left", name: "Pan left" },
    { id: "right", name: "Pan right" }, { id: "up", name: "Pan up" }, { id: "down", name: "Pan down" }]);
});

test("easing functions: endpoints and monotonic", () => {
  F.EASINGS.forEach((e) => { const f = F.easing(e.id); near(f(0), 0); near(f(1), 1); });
  ["smooth", "gentle", "snappy"].forEach((id) => {
    const f = F.easing(id);
    for (let i = 1; i <= 100; i++) assert.ok(f(i / 100) >= f((i - 1) / 100) - 1e-12, `${id} at ${i}`);
  });
  near(F.ease(0.5), 0.5);
});

test("path has frames + 1 points, endpoints equal from and to", () => {
  const p = F.path(orion, andromeda, 40);
  assert.equal(p.length, 41);
  near(p[0].ra, orion.ra); near(p[0].dec, orion.dec); near(p[0].fov, 30);
  near(p[40].ra, andromeda.ra); near(p[40].dec, andromeda.dec); near(p[40].fov, 30);
  assert.throws(() => F.path(orion, andromeda, 0), /at least 1 frame/);
});

test("Orion to Andromeda at 30 degrees: fov peaks above 30 and stays within 1..180", () => {
  const p = F.path(orion, andromeda, 100);
  const peak = Math.max(...p.map((q) => q.fov));
  assert.ok(peak > 30 && peak <= 180, `peak ${peak}`);
});

test("flight from ra 350 to ra 10 takes the short way and never passes ra 180", () => {
  const p = F.path({ ra: 350, dec: 0, fov: 30 }, { ra: 10, dec: 0, fov: 30 }, 40);
  assert.ok(p.every((q) => q.ra >= 340 || q.ra <= 20), JSON.stringify(p.map((q) => q.ra)));
  near(p[20].ra, 0, 1e-6);
});

test("flight to dec 90 has finite values at every frame", () => {
  assert.ok(finite(F.path({ ra: 0, dec: 40, fov: 30 }, { ra: 90, dec: 90, fov: 30 }, 60)));
  assert.ok(finite(F.path({ ra: 0, dec: 90, fov: 30 }, { ra: 0, dec: 40, fov: 30 }, 60)));
});

test("antipodal flight stays finite", () => {
  assert.ok(finite(F.path({ ra: 0, dec: 0, fov: 30 }, { ra: 180, dec: 0, fov: 30 }, 40)));
});

test("centre moves along the great circle: each point lies on the arc from start to end", () => {
  const a = { ra: 10, dec: 20, fov: 40 }, b = { ra: 80, dec: -30, fov: 40 };
  const total = S.angularDistance(a.ra, a.dec, b.ra, b.dec);
  F.path(a, b, 50).forEach((q) => {
    const d1 = S.angularDistance(a.ra, a.dec, q.ra, q.dec), d2 = S.angularDistance(q.ra, q.dec, b.ra, b.dec);
    near(d1 + d2, total, 1e-6);
  });
});

test("fov is clamped to 1..180 at the ends and at the peak", () => {
  const p = F.path({ ra: 0, dec: 0, fov: 0.5 }, { ra: 1, dec: 0, fov: 500 }, 30);
  near(p[0].fov, 1); near(p[30].fov, 180);
  assert.ok(p.every((q) => q.fov >= 1 && q.fov <= 180));
});

test("default options reproduce smooth easing on the normal arc", () => {
  assert.deepEqual(F.path(orion, andromeda, 60), F.path(orion, andromeda, 60, { easing: "smooth", arc: "normal" }));
});

test("higher arcs zoom out further than lower arcs", () => {
  const m = (arc) => Math.max(...F.path(orion, andromeda, 120, { arc }).map((q) => q.fov));
  assert.ok(m("high") > m("normal"), `${m("high")} ${m("normal")}`);
  assert.ok(m("normal") > m("low"), `${m("normal")} ${m("low")}`);
});

test("overshoot: position lands first at 85 %, fov peaks at 0.75 x end, then settles", () => {
  const p = F.path({ ra: 83.8, dec: -5.4, fov: 30 }, { ra: 10.7, dec: 41.3, fov: 30 }, 100, { easing: "overshoot" });
  assert.equal(p.length, 101);
  near(p[0].fov, 30);
  near(p[100].fov, 30); near(p[100].ra, 10.7); near(p[100].dec, 41.3);
  near(p[85].ra, 10.7, 1e-6); near(p[85].dec, 41.3, 1e-6); near(p[85].fov, 22.5, 1e-9);
  for (let k = 86; k <= 100; k++) {
    near(p[k].ra, 10.7, 1e-6); near(p[k].dec, 41.3, 1e-6);
    assert.ok(p[k].fov > p[k - 1].fov - 1e-12, `fov settles at ${k}`);
  }
});

test("snappy differs from smooth mid-flight", () => {
  const a = F.path(orion, andromeda, 100, { easing: "snappy" }), b = F.path(orion, andromeda, 100);
  assert.ok(Math.abs(a[25].ra - b[25].ra) > 1e-6 || Math.abs(a[25].fov - b[25].fov) > 1e-6);
});

test("driftEnd: push in and pull out change fov by 0.85 and 1 / 0.85, clamped", () => {
  near(F.driftEnd({ ra: 0, dec: 0, fov: 30 }, "in").fov, 25.5);
  near(F.driftEnd({ ra: 0, dec: 0, fov: 30 }, "out").fov, 30 / 0.85);
  near(F.driftEnd({ ra: 0, dec: 0, fov: 1 }, "in").fov, 1);
  near(F.driftEnd({ ra: 0, dec: 0, fov: 180 }, "out").fov, 180);
  const c = F.driftEnd({ ra: 40, dec: 10, fov: 30 }, "in");
  near(c.ra, 40); near(c.dec, 10);
});

test("driftEnd: Pan left increases RA at rotation 0 (east is on the left)", () => {
  const r = F.driftEnd({ ra: 100, dec: 0, fov: 30, rotation: 0 }, "left");
  near(r.ra - 100, 1.5, 1e-6); near(r.dec, 0, 1e-9); near(r.fov, 30);
  const q = F.driftEnd({ ra: 100, dec: 0, fov: 30, rotation: 0 }, "right");
  near(q.ra - 100, -1.5, 1e-6);
});

test("driftEnd: Pan up increases Dec at rotation 0, and pans move the centre 5 % of fov", () => {
  const r = F.driftEnd({ ra: 100, dec: 0, fov: 30, rotation: 0 }, "up");
  near(r.dec, 1.5, 1e-6); near(r.ra, 100, 1e-6);
  const d = F.driftEnd({ ra: 100, dec: 0, fov: 30, rotation: 0 }, "down");
  near(d.dec, -1.5, 1e-6);
});

test("driftEnd: pans honour rotation (at 90 degrees, screen left is north, so Pan left raises Dec)", () => {
  const r = F.driftEnd({ ra: 100, dec: 0, fov: 30, rotation: 90 }, "left");
  near(r.dec, 1.5, 1e-6); near(r.ra, 100, 1e-6);
});

test("driftPath: endpoints exact, frames + 1 points, short way round", () => {
  const a = { ra: 350, dec: 10, fov: 20 }, b = { ra: 10, dec: 14, fov: 30 };
  const p = F.driftPath(a, b, 4, "gentle");
  assert.equal(p.length, 5);
  near(p[0].ra, 350); near(p[0].dec, 10); near(p[0].fov, 20);
  near(p[4].ra, 10); near(p[4].dec, 14); near(p[4].fov, 30);
  assert.ok(p.every((q) => q.ra >= 340 || q.ra <= 20), JSON.stringify(p));
  assert.throws(() => F.driftPath(a, b, 0, "gentle"), /at least 1 frame/);
});

test("driftPath: eased halfway point matches gentle easing at 0.5", () => {
  const p = F.driftPath({ ra: 0, dec: 0, fov: 20 }, { ra: 10, dec: 0, fov: 40 }, 2, "gentle");
  near(p[1].fov, 30, 1e-9); near(p[1].ra, 5, 1e-6);
});

const raDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("pole endpoint: the RA jump at the last frame is under 1 degree (path to the pole)", () => {
  const p = F.path({ ra: 0, dec: 40, fov: 30 }, { ra: 90, dec: 90, fov: 30 }, 60);
  assert.ok(raDiff(p[59].ra, p[60].ra) < 1, `${p[59].ra} vs ${p[60].ra}`);
  near(p[60].dec, 90); near(p[60].fov, 30);
});

test("pole endpoint: the RA jump at the first frame is under 1 degree (path from the pole)", () => {
  const p = F.path({ ra: 45, dec: 90, fov: 30 }, { ra: 0, dec: 40, fov: 30 }, 60);
  assert.ok(raDiff(p[0].ra, p[1].ra) < 1, `${p[0].ra} vs ${p[1].ra}`);
  near(p[0].dec, 90); near(p[0].fov, 30);
  near(p[60].ra, 0, 1e-9); near(p[60].dec, 40, 1e-9);
});

test("non-pole endpoints stay exact", () => {
  const p = F.path({ ra: 83.8, dec: -5.4, fov: 30 }, { ra: 10.7, dec: 41.3, fov: 30 }, 40);
  near(p[0].ra, 83.8); near(p[0].dec, -5.4); near(p[40].ra, 10.7); near(p[40].dec, 41.3);
  const d = F.driftPath({ ra: 10, dec: 20, fov: 30 }, { ra: 30, dec: 60, fov: 20 }, 10);
  near(d[0].ra, 10); near(d[10].ra, 30); near(d[10].dec, 60); near(d[10].fov, 20);
});

test("driftPath: pole endpoints take their neighbour's RA", () => {
  const up = F.driftPath({ ra: 0, dec: 40, fov: 30 }, { ra: 90, dec: 90, fov: 30 }, 60, "smooth");
  assert.ok(raDiff(up[59].ra, up[60].ra) < 1);
  const down = F.driftPath({ ra: 45, dec: -90, fov: 30 }, { ra: 0, dec: -40, fov: 30 }, 60, "smooth");
  assert.ok(raDiff(down[0].ra, down[1].ra) < 1);
  near(down[0].dec, -90); near(down[0].fov, 30);
});
