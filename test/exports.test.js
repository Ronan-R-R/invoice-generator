const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('./load-xlsx.js');
const core = require('../js/core.js');
const { buildWorkbook, COLORS } = require('../js/xlsx-export.js');
const { buildPrintHtml } = require('../js/print.js');

function sampleState(overrides) {
  return Object.assign({
    dailyRate: 2000,
    baseHours: 10,
    rows: [
      { type: 'Pre-Production', days: 2, desc: 'Prep', call: '', wrap: '' },
      { type: 'Shoot Day', desc: 'Shoot day 1', call: '06:00', wrap: '23:00', date: '2026-10-20' },
      { type: 'Shoot Day', desc: 'Shoot day 2', call: '06:00', wrap: '16:00', date: '2026-10-21' },
      { type: 'Premium Day', desc: 'Sunday', call: '07:00', wrap: '19:00', date: '2026-10-25' },
      { type: 'Premium Day', desc: 'Sunday no times', call: '', wrap: '' },
      { type: 'Travel Day', days: 1, desc: 'Travel' },
    ],
    extras: { toolbox: { days: 2, rate: 250 } },
  }, overrides);
}

function header(extra) {
  return Object.assign({
    fromName: 'Thandi Mokoena', jobName: 'Karoo Light TVC', invNumber: 'INV-2026-0007', invDate: '2026-10-22',
    toName: 'Karoo Light Pictures',
  }, extra);
}

function roundTrip(wb) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, book: XLSX.read(buf, { type: 'buffer', cellFormula: true, bookFiles: true }) };
}

function findRowByLabel(ws, col, label) {
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith(col) && ws[addr].v === label) return Number(addr.slice(col.length));
  }
  return null;
}

test('xlsx amount cells carry formulas with cached values that match the app', () => {
  const invoice = core.computeInvoice(sampleState());
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;

  const start = findRowByLabel(ws, 'B', 'Prep');
  assert.ok(start, 'timesheet rows present');
  invoice.lines.forEach(({ c }, i) => {
    const cell = ws['M' + (start + i)];
    assert.ok(cell.f, 'row ' + i + ' amount is a formula');
    assert.equal(Math.round(cell.v), Math.round(c.amount), 'row ' + i + ' cached amount');
  });
  assert.match(ws['M' + start].f, /\+K/, 'pre-production amount includes T/A, same as the app');
});

test('xlsx premium and untimed rows hold numbers, not text, so Excel can add them', () => {
  const invoice = core.computeInvoice(sampleState());
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  const start = findRowByLabel(ws, 'B', 'Prep');
  for (let r = start; r < start + invoice.lines.length; r++) {
    for (const col of ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      assert.equal(ws[col + r].t, 'n', col + r + ' should be numeric');
    }
  }
  const premium = start + 3;
  assert.match(ws['D' + premium].f, /^MIN\(MAX\(12-10,0\),4\)$/);
  assert.equal(ws['E' + premium].v, 900);
});

test('xlsx 12hr deal caps x1.5 at 2 hrs and x2 at 4 hrs', () => {
  const invoice = core.computeInvoice(sampleState({
    baseHours: 12,
    rows: [{ type: 'Shoot Day', desc: 'Long day', call: '04:00', wrap: '00:00' }],
  }));
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  const r = findRowByLabel(ws, 'B', 'Long day');
  assert.equal(ws['D' + r].f, 'MIN(MAX(20-12,0),2)');
  assert.equal(ws['F' + r].f, 'MIN(MAX(20-12-2,0),4)');
  assert.equal(ws['F' + r].v, 4);
  assert.equal(Math.round(ws['M' + r].v), 4200);
});

test('xlsx writes user text that starts with = as a string, never a formula', () => {
  const invoice = core.computeInvoice(sampleState({
    rows: [{ type: 'Shoot Day', desc: '=HYPERLINK("http://evil.test","click")', call: '07:00', wrap: '17:00' }],
  }));
  const { wb } = buildWorkbook(XLSX, { header: header({ toName: '=1+1' }), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  const cells = Object.values(ws).filter(c => c && c.v === '=1+1' || (c && typeof c.v === 'string' && c.v.startsWith('=HYPERLINK')));
  assert.equal(cells.length, 2);
  cells.forEach(c => { assert.equal(c.t, 's'); assert.equal(c.f, undefined); });
});

test('xlsx output contains the purple styling', () => {
  const invoice = core.computeInvoice(sampleState());
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const { buf } = roundTrip(wb);
  const zip = XLSX.CFB.read(buf, { type: 'buffer' });
  const idx = zip.FullPaths.findIndex(p => p.endsWith('/xl/styles.xml'));
  assert.ok(idx >= 0, 'styles.xml present');
  const xml = Buffer.from(zip.FileIndex[idx].content).toString('utf8');
  assert.ok(xml.includes('FF' + COLORS.ACCENT), 'accent fill written');
  assert.ok(!/C8921A/i.test(xml), 'no old orange left');
});

test('xlsx puts text only in the top-left cell of each merge, where Excel shows it', () => {
  const invoice = core.computeInvoice(sampleState());
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  const hidden = [];
  ws['!merges'].forEach(m => {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== '' && cell.v != null) hidden.push(XLSX.utils.encode_cell({ r, c }) + '=' + cell.v);
      }
    }
  });
  assert.deepEqual(hidden, []);
});

test('xlsx total rows carry their labels', () => {
  const invoice = core.computeInvoice(sampleState());
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  for (const label of ['Subtotal, taxable', 'TOTAL TAXABLE', 'Less: PAYE 25%', 'Net taxable (after PAYE)', 'EXTRAS SUBTOTAL']) {
    const row = findRowByLabel(ws, 'J', label);
    assert.ok(row, label + ' is in the visible merge cell');
    assert.ok(ws['M' + row].f, label + ' row has its amount formula');
  }
});

function mergeAt(ws, addr) {
  const { r, c } = XLSX.utils.decode_cell(addr);
  return ws['!merges'].find(m => m.s.r === r && m.s.c === c);
}

test('xlsx widens column B to fit the longest timesheet description', () => {
  const longDesc = 'Shoot day 3, second unit, Clanwilliam dam location';
  const invoice = core.computeInvoice(sampleState({ rows: [{ type: 'Shoot Day', desc: longDesc, call: '07:00', wrap: '17:00' }] }));
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  assert.ok(wb.Sheets.Invoice['!cols'][1].wch >= longDesc.length, 'got ' + wb.Sheets.Invoice['!cols'][1].wch);
});

test('xlsx merges party values across B:E and H:K instead of widening the columns', () => {
  const longAddr = 'Unit 4, The Old Biscuit Mill, 373-375 Albert Road, Woodstock, Cape Town';
  const invoice = core.computeInvoice(sampleState({ rows: [] }));
  const { wb } = buildWorkbook(XLSX, { header: header({ toAddr: longAddr, fromAddr: longAddr, bankName: 'FNB' }), invoice });
  const ws = wb.Sheets.Invoice;

  const toAddr = Object.keys(ws).find(a => a.startsWith('B') && ws[a].v === longAddr);
  const fromAddr = Object.keys(ws).find(a => a.startsWith('H') && ws[a].v === longAddr);
  const bank = Object.keys(ws).find(a => a.startsWith('B') && ws[a].v === 'FNB');
  assert.deepEqual(mergeAt(ws, toAddr).e.c, 4, 'to-party value spans B:E');
  assert.deepEqual(mergeAt(ws, fromAddr).e.c, 10, 'from-party value spans H:K');
  assert.deepEqual(mergeAt(ws, bank).e.c, 4, 'bank value spans B:E');
  assert.equal(ws[toAddr].s.alignment.wrapText, true);

  assert.equal(ws['!cols'][1].wch, 26, 'B is not stretched by party values');
  assert.equal(ws['!cols'][7].wch, 11, 'H is not stretched by party values');
  const row = Number(toAddr.slice(1));
  assert.ok(ws['!rows'][row - 1].hpt > 15, 'row grows to show the wrapped address, got ' + ws['!rows'][row - 1].hpt);
  const short = Object.keys(ws).find(a => a.startsWith('B') && ws[a].v === 'Karoo Light Pictures');
  assert.equal(ws['!rows'][Number(short.slice(1)) - 1].hpt, 15, 'a short value keeps the normal height');
});

test('xlsx keeps B and H at their minimum widths for short values and caps runaway text', () => {
  const invoice = core.computeInvoice(sampleState({ rows: [{ type: 'Shoot Day', desc: 'x'.repeat(200), call: '07:00', wrap: '17:00' }] }));
  const short = buildWorkbook(XLSX, { header: { invNumber: 'INV-2026-0001' }, invoice: core.computeInvoice(sampleState({ rows: [] })) }).wb.Sheets.Invoice['!cols'];
  assert.equal(short[1].wch, 26);
  assert.equal(short[7].wch, 11);
  const long = buildWorkbook(XLSX, { header: header(), invoice }).wb.Sheets.Invoice['!cols'];
  assert.equal(long[1].wch, 80);
});

test('xlsx with no timesheet rows still builds and totals to extras only', () => {
  const invoice = core.computeInvoice(sampleState({ rows: [] }));
  const { wb } = buildWorkbook(XLSX, { header: header(), invoice });
  const ws = roundTrip(wb).book.Sheets.Invoice;
  const sub = findRowByLabel(ws, 'J', 'Subtotal, taxable');
  assert.equal(ws['M' + sub].f, '0');
  assert.equal(invoice.grand, 500);
});

test('xlsx filename is built from safe segments of the invoice number, crew and job', () => {
  const invoice = core.computeInvoice(sampleState());
  const { filename } = buildWorkbook(XLSX, { header: header({ fromName: '../Thandi <M>' }), invoice });
  assert.equal(filename, 'INV-2026-0007_Thandi_M_Karoo_Light_TVC.xlsx');
});

test('print sheet escapes every user field', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const invoice = core.computeInvoice(sampleState({
    rows: [{ type: 'Shoot Day', desc: payload, call: '07:00', wrap: '17:00', date: '2026-10-20' }],
  }));
  const html = buildPrintHtml({ header: header({ fromName: payload, toName: payload, bankAcc: payload, invNumber: payload }), invoice });
  assert.ok(!html.includes('<img'), 'no raw tag in output');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('print sheet shows totals and the invoice number', () => {
  const invoice = core.computeInvoice(sampleState());
  const html = buildPrintHtml({ header: header(), invoice });
  assert.ok(html.includes('INV-2026-0007'));
  assert.ok(html.includes(core.formatRand(invoice.grand)));
  assert.ok(html.includes('T/A penalties (1 violation'));
});

test('print sheet handles an empty timesheet', () => {
  const invoice = core.computeInvoice(sampleState({ rows: [] }));
  const html = buildPrintHtml({ header: header(), invoice });
  assert.ok(html.includes('No days entered'));
});
