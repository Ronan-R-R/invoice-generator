const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/core.js');

const DR = 2000;

function shoot(call, wrap, extra) {
  return Object.assign({ type: 'Shoot Day', call, wrap }, extra);
}

test('parseTimeInput accepts the shorthand crews type', () => {
  assert.equal(core.parseTimeInput('8'), '08:00');
  assert.equal(core.parseTimeInput('0800'), '08:00');
  assert.equal(core.parseTimeInput('815'), '08:15');
  assert.equal(core.parseTimeInput('8.15'), '08:15');
  assert.equal(core.parseTimeInput('21:30'), '21:30');
  assert.equal(core.parseTimeInput(' 7:30 '), '07:30');
});

test('parseTimeInput snaps to 15 minutes', () => {
  assert.equal(core.parseTimeInput('7:07'), '07:00');
  assert.equal(core.parseTimeInput('7:08'), '07:15');
  assert.equal(core.parseTimeInput('7:53'), '08:00');
});

test('parseTimeInput rolls 23:53 over to midnight instead of clamping to 23:00', () => {
  assert.equal(core.parseTimeInput('23:53'), '00:00');
});

test('parseTimeInput reads 24:00 as midnight', () => {
  assert.equal(core.parseTimeInput('24:00'), '00:00');
});

test('parseTimeInput rejects text that is not a time instead of returning 00:00', () => {
  for (const bad of ['abc', '', '   ', ':', '25:00', '12:75', '<img src=x>', '123456', '1:2:3', null, undefined, 42]) {
    assert.equal(core.parseTimeInput(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('shoot day under the base hours is a flat day rate', () => {
  const c = core.calcRow(shoot('07:00', '17:00'), DR, 10);
  assert.equal(c.totalHrs, 10);
  assert.equal(c.ot15h, 0);
  assert.equal(c.amount, 2000);
});

test('shoot day on a 10hr standard pays 4 hrs at x1.5 then x2', () => {
  const c = core.calcRow(shoot('06:30', '21:00'), DR, 10);
  assert.equal(c.totalHrs, 14.5);
  assert.equal(c.ot15h, 4);
  assert.equal(c.ot15c, 1200);
  assert.equal(c.ot2h, 0.5);
  assert.equal(c.ot2c, 200);
  assert.equal(c.amount, 3400);
});

test('shoot day on a 12hr deal pays 2 hrs at x1.5 then x2', () => {
  const c = core.calcRow(shoot('06:00', '21:00'), DR, 12);
  assert.equal(c.ot15h, 2);
  assert.equal(c.ot2h, 1);
  assert.equal(c.amount, 2000 + 600 + 400);
});

test('12hr deal caps x2 at 4 hrs and only pays x3 when flagged past midnight', () => {
  const plain = core.calcRow(shoot('04:00', '00:00'), DR, 12);
  assert.equal(plain.totalHrs, 20);
  assert.equal(plain.ot2h, 4);
  assert.equal(plain.ot3h, 0);
  assert.equal(plain.amount, 2000 + 600 + 1600);

  const late = core.calcRow(shoot('04:00', '00:00', { pastMidnight: true }), DR, 12);
  assert.equal(late.ot3h, 2);
  assert.equal(late.ot3c, 1200);
  assert.equal(late.amount, 2000 + 600 + 1600 + 1200);
});

test('overnight wrap counts hours across midnight', () => {
  const c = core.calcRow(shoot('18:00', '02:00'), DR, 10);
  assert.equal(c.totalHrs, 8);
  assert.equal(c.amount, 2000);
});

test('shoot day with no times is one day rate', () => {
  assert.equal(core.calcRow(shoot('', ''), DR, 10).amount, 2000);
});

test('premium day is 1.5x with OT on the premium hourly', () => {
  const c = core.calcRow({ type: 'Premium Day', call: '07:00', wrap: '19:00' }, DR, 10);
  assert.equal(c.ot15h, 2);
  assert.equal(c.ot15c, 900);
  assert.equal(c.amount, 3900);
  assert.equal(core.calcRow({ type: 'Premium Day', call: '', wrap: '' }, DR, 10).amount, 3000);
});

test('pre-production is days x day rate', () => {
  assert.equal(core.calcRow({ type: 'Pre-Production', days: 2 }, DR, 10).amount, 4000);
});

test('travel day is half rate, and 0 days charges nothing instead of a full day', () => {
  assert.equal(core.calcRow({ type: 'Travel Day', days: 1 }, DR, 10).amount, 1000);
  assert.equal(core.calcRow({ type: 'Travel Day', days: 0 }, DR, 10).amount, 0);
  assert.equal(core.calcRow({ type: 'Travel Day', days: '' }, DR, 10).amount, 1000);
});

test('cancellation day pays 50% by default and 25% when chosen', () => {
  assert.equal(core.calcRow({ type: 'Cancellation Day', days: 1 }, DR, 10).amount, 1000);
  assert.equal(core.calcRow({ type: 'Cancellation Day', days: 1, cancelPct: 25 }, DR, 10).amount, 500);
});

test('turnaround under 10 hrs on consecutive days is penalised in tiers', () => {
  const rows = [
    shoot('06:00', '23:00', { date: '2026-03-02' }),
    shoot('06:00', '16:00', { date: '2026-03-03' }),
  ];
  core.calcTurnaround(rows, DR);
  assert.equal(rows[0].tac, 0);
  assert.equal(rows[1].tah, 3);
  assert.equal(rows[1].tac, 2 * 200 + 1 * 400);
  assert.equal(rows[1].taWarn, 'T/A');
});

test('turnaround past 4 hrs short hits the x3 tier', () => {
  const rows = [shoot('06:00', '23:00'), shoot('04:00', '14:00')];
  core.calcTurnaround(rows, DR);
  assert.equal(rows[1].tah, 5);
  assert.equal(rows[1].tac, 2 * 200 + 2 * 400 + 1 * 600);
});

test('no turnaround penalty when a full day sits between shoots', () => {
  const rows = [
    shoot('06:00', '23:00', { date: '2026-03-02' }),
    shoot('06:00', '16:00', { date: '2026-03-04' }),
  ];
  core.calcTurnaround(rows, DR);
  assert.equal(rows[1].tac, 0);
});

test('turnaround skips untimed rows when looking back', () => {
  const rows = [
    shoot('06:00', '23:00', { date: '2026-03-02' }),
    { type: 'Travel Day', days: 1, date: '2026-03-03' },
    shoot('06:00', '16:00', { date: '2026-03-03' }),
  ];
  core.calcTurnaround(rows, DR);
  assert.equal(rows[2].tah, 3);
});

test('computeInvoice totals taxable, PAYE, extras and grand total', () => {
  const inv = core.computeInvoice({
    dailyRate: 2000,
    baseHours: 10,
    rows: [
      { type: 'Pre-Production', days: 2 },
      shoot('06:00', '18:00'),
      shoot('06:30', '21:00'),
    ],
    extras: { toolbox: { days: 2, rate: 250 }, meals: { days: 2, rate: 100 } },
  });
  assert.equal(inv.taxable, 4000 + 2600 + 3400);
  assert.equal(inv.paye, 2500);
  assert.equal(inv.extrasTotal, 700);
  assert.equal(inv.grand, 10000 - 2500 + 700);
  assert.equal(inv.extras.find(e => e.key === 'vehicle').rate, 550, 'missing extras fall back to the default rate');
});

test('computeInvoice does not mutate the rows it was given', () => {
  const rows = [shoot('06:00', '23:00'), shoot('06:00', '16:00')];
  core.computeInvoice({ dailyRate: 2000, baseHours: 10, rows, extras: {} });
  assert.equal(rows[1].tac, undefined);
});

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(core.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(core.escapeHtml("O'Neil & Co"), 'O&#39;Neil &amp; Co');
  assert.equal(core.escapeHtml(null), '');
  assert.equal(core.escapeHtml(0), '0');
});

test('formatInvoiceNumber pads the sequence and takes the year from the invoice date', () => {
  const seq = { prefix: 'INV', next: 7 };
  assert.equal(core.formatInvoiceNumber(seq, '2026-10-22'), 'INV-2026-0007');
  assert.equal(core.formatInvoiceNumber(seq, '2027-01-03'), 'INV-2027-0007');
});

test('isAutoNumber recognises the current preview in any year only', () => {
  const seq = { prefix: 'INV', next: 7 };
  assert.equal(core.isAutoNumber('INV-2026-0007', seq), true);
  assert.equal(core.isAutoNumber('INV-2027-0007', seq), true);
  assert.equal(core.isAutoNumber('INV-2026-0006', seq), false);
  assert.equal(core.isAutoNumber('MY-OWN-1', seq), false);
});

test('advanceSequence moves past the issued number', () => {
  const seq = { prefix: 'INV', next: 7 };
  assert.equal(core.advanceSequence(seq, 'INV-2026-0007').next, 8);
  assert.equal(core.advanceSequence(seq, 'INV-2026-0050').next, 51, 'a hand-typed higher number pushes the counter forward');
  assert.equal(core.advanceSequence(seq, 'INV-2026-0003').next, 7, 'an older number never moves the counter back');
  assert.equal(core.advanceSequence(seq, 'ACME-17').next, 7, 'other formats leave the counter alone');
});

test('sanitizeSequence falls back to defaults on bad values', () => {
  assert.deepEqual(core.sanitizeSequence(null), { prefix: 'INV', next: 1 });
  assert.deepEqual(core.sanitizeSequence({ prefix: 'inv<script>', next: -4 }), { prefix: 'INV', next: 1 });
  assert.deepEqual(core.sanitizeSequence({ prefix: 'crw', next: 12 }), { prefix: 'CRW', next: 12 });
  assert.deepEqual(core.sanitizeSequence({ prefix: 'CRW', next: 1.5 }), { prefix: 'CRW', next: 1 });
});

test('sanitizeState loads a v1 session file with flat extras', () => {
  const state = core.sanitizeState({
    version: 1,
    header: { fromName: 'Thandi Mokoena', invDate: '2026-10-22', invNumber: 'INV-JO-TM-2210' },
    dailyRate: '2500',
    baseHours: 12,
    rows: [{ id: 9, type: 'Shoot Day', call: '06:00', wrap: '19:00', date: '2026-10-20' }],
    extras: { toolboxDays: '3', toolboxRate: '250', mealsDays: '2' },
  });
  assert.equal(state.version, 2);
  assert.equal(state.header.fromName, 'Thandi Mokoena');
  assert.equal(state.dailyRate, 2500);
  assert.equal(state.baseHours, 12);
  assert.equal(state.rows[0].call, '06:00');
  assert.deepEqual(state.extras.toolbox, { days: 3, rate: 250 });
  assert.deepEqual(state.extras.meals, { days: 2, rate: 100 });
  assert.equal(state.invIssued, false);
});

test('sanitizeState rejects files that are not sessions', () => {
  assert.throws(() => core.sanitizeState(null));
  assert.throws(() => core.sanitizeState([]));
  assert.throws(() => core.sanitizeState({ version: 3, header: {} }));
  assert.throws(() => core.sanitizeState({ version: 1 }));
});

test('sanitizeState drops unknown fields and repairs bad values', () => {
  const state = core.sanitizeState({
    version: 2,
    header: { toName: 'x'.repeat(5000), invDate: 'yesterday', __proto__: { polluted: true }, evil: 'y' },
    rows: [
      { type: 'Free Money Day', call: 'soon', wrap: '17:00', date: '<b>', days: 9999, cancelPct: 90 },
    ],
    dailyRate: 'NaN',
    extras: { toolbox: { days: -5, rate: 'abc' } },
  });
  assert.equal(state.header.toName.length, 200);
  assert.equal(state.header.invDate, '');
  assert.equal('evil' in state.header, false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(
    state.rows[0],
    { id: 1, date: '', desc: '', type: 'Shoot Day', call: '', wrap: '17:00', days: 365, cancelPct: 50, pastMidnight: false },
  );
  assert.equal(state.dailyRate, 2000);
  assert.deepEqual(state.extras.toolbox, { days: 0, rate: 250 });
});

test('sanitizeState caps the number of rows', () => {
  const rows = Array.from({ length: 1000 }, () => ({ type: 'Shoot Day' }));
  assert.equal(core.sanitizeState({ version: 2, header: {}, rows }).rows.length, core.MAX_ROWS);
});

test('directory import keeps allowlisted fields and drops entries without a name', () => {
  const parsed = core.sanitizeDirectoryFile({
    kind: 'invoice-generator-directory',
    crew: [{ name: 'Sipho Dlamini', rate: '2800', role: 'ignored' }, { designation: 'no name' }, 'junk'],
    production: [{ companyName: 'Karoo Light Pictures', vat: '4123456789' }],
  });
  assert.equal(parsed.crew.length, 1);
  assert.equal(parsed.crew[0].rate, '2800');
  assert.equal('role' in parsed.crew[0], false);
  assert.equal(parsed.production[0].vat, '4123456789');
  assert.throws(() => core.sanitizeDirectoryFile({ crew: [] }));
});

test('mergeDirectory replaces same-name entries and keeps the rest', () => {
  const merged = core.mergeDirectory(
    [{ name: 'Sipho Dlamini', rate: '2500' }, { name: 'Ayesha Patel', rate: '3000' }],
    [{ name: 'Sipho Dlamini', rate: '2800' }, { name: 'Lerato Khumalo', rate: '2200' }],
    'crew',
  );
  assert.deepEqual(merged.map(e => e.name + ':' + e.rate), ['Sipho Dlamini:2800', 'Ayesha Patel:3000', 'Lerato Khumalo:2200']);
});

test('safeFileSegment strips path and shell characters', () => {
  assert.equal(core.safeFileSegment('../../etc/passwd', 'x'), 'etcpasswd');
  assert.equal(core.safeFileSegment('Takealot TVC 2026', 'x'), 'Takealot_TVC_2026');
  assert.equal(core.safeFileSegment('', 'Crew'), 'Crew');
});
