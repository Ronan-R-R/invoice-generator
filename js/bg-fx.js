// Background grid motion: a slow passive drift, plus a spotlight that follows the mouse and
// wanders on its own when the mouse is idle or the device has no mouse.
// Every frame only changes transforms, so the browser composites and never repaints the grid.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BgFx = api;
  if (typeof window !== 'undefined' && window.document) api.start(window);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CELL = 40;           // must match the 40px gradient period in css/styles.css
  const DRIFT_PX_PER_S = 4;
  const SPOT_SIZE = 560;     // must match .bg-spot width and height
  const FOLLOW_FOR_MS = 2500;
  const FOLLOW_TAU_MS = 90;
  const RETURN_TAU_MS = 1400;

  function mod(n, m) { return ((n % m) + m) % m; }

  // Offset for a grid layer whose box starts at `start` (viewport px, box inset -CELL),
  // so its lines sit exactly on the page grid after the drift.
  function gridOffset(drift, start) { return mod(drift - start, CELL); }

  // A slow figure-eight that stays inside the middle of the viewport
  function wanderPoint(t, w, h) {
    const s = t / 1000;
    return {
      x: w * (0.5 + 0.34 * Math.sin(s * 0.13) * Math.cos(s * 0.041)),
      y: h * (0.45 + 0.3 * Math.sin(s * 0.09 + 1.3)),
    };
  }

  // Frame-rate independent easing toward a target
  function approach(current, target, dt, tau) {
    return current + (target - current) * (1 - Math.exp(-Math.max(dt, 0) / tau));
  }

  function start(win) {
    const doc = win.document;
    const layer = doc.querySelector('.bg-fx');
    if (!layer || !win.requestAnimationFrame) return;
    const grid = layer.querySelector('.bg-grid');
    const spot = layer.querySelector('.bg-spot');
    const spotGrid = layer.querySelector('.bg-spot-grid');
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
    const half = SPOT_SIZE / 2;

    let w = win.innerWidth;
    let h = win.innerHeight;
    let pos = wanderPoint(win.performance.now(), w, h);
    let mouse = null;
    let lastMove = -Infinity;
    let last = null;
    let raf = 0;

    function frame(now) {
      const dt = last === null ? 16 : Math.min(now - last, 100);
      last = now;
      const drift = (now / 1000) * DRIFT_PX_PER_S;
      const following = mouse !== null && now - lastMove < FOLLOW_FOR_MS;
      const target = following ? mouse : wanderPoint(now, w, h);
      const tau = following ? FOLLOW_TAU_MS : RETURN_TAU_MS;
      pos = { x: approach(pos.x, target.x, dt, tau), y: approach(pos.y, target.y, dt, tau) };

      const d = mod(drift, CELL);
      const left = pos.x - half;
      const top = pos.y - half;
      grid.style.transform = 'translate3d(' + d + 'px,' + d + 'px,0)';
      spot.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
      spotGrid.style.transform = 'translate3d(' + gridOffset(drift, left) + 'px,' + gridOffset(drift, top) + 'px,0)';
      raf = win.requestAnimationFrame(frame);
    }

    function run() {
      if (raf) return;
      layer.classList.remove('is-static');
      last = null;
      raf = win.requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      layer.classList.add('is-static');
      grid.style.transform = '';
    }

    win.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      mouse = { x: e.clientX, y: e.clientY };
      lastMove = win.performance.now();
    }, { passive: true });
    doc.documentElement.addEventListener('mouseleave', () => { lastMove = -Infinity; });
    win.addEventListener('resize', () => { w = win.innerWidth; h = win.innerHeight; }, { passive: true });

    const sync = () => (reduce.matches ? stop() : run());
    if (reduce.addEventListener) reduce.addEventListener('change', sync);
    sync();
  }

  return { CELL, SPOT_SIZE, mod, gridOffset, wanderPoint, approach, start };
});
