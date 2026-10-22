const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../js/bg-fx.js');

test('mod stays positive for negative input', () => {
  assert.equal(fx.mod(-1, 40), 39);
  assert.equal(fx.mod(-80, 40), 0);
  assert.equal(fx.mod(85, 40), 5);
});

test('gridOffset puts the spotlight grid in phase with the page grid', () => {
  for (const drift of [0, 3.25, 39.9, 1234.5]) {
    for (const start of [-280, -13.7, 0, 517.3, 1903]) {
      const offset = fx.gridOffset(drift, start);
      assert.ok(offset >= 0 && offset < fx.CELL, 'offset in range for ' + drift + ',' + start);
      // The layer box starts one cell before `start`; its first line origin must match the page grid origin
      const origin = start - fx.CELL + offset;
      const phase = fx.mod(origin - drift, fx.CELL);
      assert.ok(phase < 1e-9 || fx.CELL - phase < 1e-9, 'in phase for drift ' + drift + ', start ' + start + ', got ' + phase);
    }
  }
});

test('wanderPoint stays inside the middle of the viewport', () => {
  const w = 1440, h = 900;
  for (let t = 0; t < 600000; t += 997) {
    const p = fx.wanderPoint(t, w, h);
    assert.ok(p.x >= w * 0.15 && p.x <= w * 0.85, 'x ' + p.x + ' at ' + t);
    assert.ok(p.y >= h * 0.14 && p.y <= h * 0.76, 'y ' + p.y + ' at ' + t);
  }
});

test('wanderPoint moves slowly enough to read as ambient', () => {
  const w = 1440, h = 900;
  let fastest = 0;
  for (let t = 0; t < 120000; t += 16) {
    const a = fx.wanderPoint(t, w, h), b = fx.wanderPoint(t + 16, w, h);
    fastest = Math.max(fastest, Math.hypot(b.x - a.x, b.y - a.y) / 0.016);
  }
  assert.ok(fastest < 120, 'peak speed ' + fastest.toFixed(1) + 'px/s');
});

test('approach eases toward the target without overshooting', () => {
  assert.equal(fx.approach(0, 100, 0, 90), 0, 'no time, no movement');
  const step = fx.approach(0, 100, 16, 90);
  assert.ok(step > 0 && step < 100);
  let v = 0;
  for (let i = 0; i < 200; i++) v = fx.approach(v, 100, 16, 90);
  assert.ok(v <= 100 && v > 99.9);
  assert.equal(fx.approach(50, 100, -10, 90), 50, 'a negative dt from a clock hiccup is ignored');
});

test('approach gives the same result at 30fps and 120fps', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 30; i++) a = fx.approach(a, 100, 1000 / 30, 300);
  for (let i = 0; i < 120; i++) b = fx.approach(b, 100, 1000 / 120, 300);
  assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
});
