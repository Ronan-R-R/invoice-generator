// Builds the styled XLSX invoice. Needs xlsx-js-style: SheetJS community drops cell styles on write.
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.InvoiceCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoiceXlsx = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  // xlsx-js-style prefixes "FF" itself, so colours are 6-digit RGB
  const C = {
    WHITE: 'FFFFFF', OFF_WHITE: 'FAF9FC', ROW_ALT: 'F5F3F9', BORDER: 'DAD4E6',
    TEXT: '1A1625', TEXT_DIM: '5E5770', TEXT_MUTED: '9890A8',
    ACCENT: '7A4FD0', ACCENT_DARK: '4E2C96', ACCENT_BG: 'F6F1FE', ACCENT_MID: 'E9DEFC', ACCENT_BANNER: 'DCCBFA',
    SECTION_BG: '1E1A28', SECTION_FG: 'C9AEF7',
    OT_HEAD_BG: 'EFE6FD', OT_HEAD_FG: '4E2C96', OT_CELL_BG: 'FAF7FF',
    TA_HEAD_BG: 'FFF4CC', TA_HEAD_FG: '6E5100', TA_CELL_BG: 'FFFBE8',
    GREEN_BG: 'F0FAF4', GREEN_HEAD: 'D8F0E4', GREEN_FG: '1E6B3A',
    SUB_BG: 'F8F5FC', TOTAL_BG: 'E9DEFC',
    PAYE_BG: 'FDECEA', PAYE_FG: 'B83232',
  };
  const RAND = '"R "#,##0;-"R "#,##0;"-"';
  const HRS = '0.00;-0.00;"-"';
  const NCOLS = 13;

  function style(o) {
    const s = {
      font: { name: 'Calibri', sz: o.sz || 10, bold: !!o.bold, italic: !!o.italic, color: { rgb: o.color || C.TEXT } },
      alignment: { horizontal: o.align || 'left', vertical: 'center', wrapText: !!o.wrap, indent: o.indent || 0 },
    };
    if (o.bg) s.fill = { patternType: 'solid', fgColor: { rgb: o.bg } };
    if (o.border) {
      const b = { style: 'thin', color: { rgb: C.BORDER } };
      s.border = { top: b, bottom: b, left: b, right: b };
    }
    if (o.numFmt) s.numFmt = o.numFmt;
    return s;
  }

  function colName(n) { return n < 26 ? String.fromCharCode(65 + n) : 'A' + String.fromCharCode(65 + n - 26); }

  // Formulas only ever come from this file as {f, v}. Everything the user typed is written as a
  // plain string, so a description like "=HYPERLINK(...)" can never become a live formula.
  function put(ws, addr, value, opts) {
    let cell;
    if (value && typeof value === 'object' && typeof value.f === 'string') {
      cell = { t: 'n', f: value.f, v: Number.isFinite(value.v) ? value.v : 0 };
    } else if (typeof value === 'number') {
      cell = { t: 'n', v: Number.isFinite(value) ? value : 0 };
    } else {
      cell = { t: 's', v: value == null ? '' : String(value) };
    }
    cell.s = style(opts || {});
    ws[addr] = cell;
  }

  function round(n, dp) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

  function buildWorkbook(XLSX, data) {
    const h = data.header;
    const inv = data.invoice;
    const dr = inv.dailyRate;
    const base = inv.baseHours;
    const hr = dr / 10;
    const cap15 = base === 12 ? 2 : 4;
    const cap2 = base === 12 ? 4 : null;

    const ws = {};
    const merges = [];
    const rowH = [];
    let R = 1;

    const merge = (r, c1, c2) => merges.push({ s: { r: r - 1, c: c1 }, e: { r: r - 1, c: c2 } });
    const fill = (r, opts, from, to) => {
      for (let c = from || 0; c < (to == null ? NCOLS : to); c++) put(ws, colName(c) + r, '', opts);
    };
    const spacer = () => { rowH[R - 1] = { hpt: 6 }; fill(R, { bg: C.WHITE }); R++; };
    const band = (label, sz) => {
      rowH[R - 1] = { hpt: 18 };
      fill(R, { bg: C.SECTION_BG });
      put(ws, 'A' + R, label, { bg: C.SECTION_BG, color: C.SECTION_FG, sz: sz || 11, bold: true, indent: 1 });
      merge(R, 0, NCOLS - 1);
      R++;
    };
    const lbl = { color: C.TEXT_MUTED, sz: 9, align: 'right', indent: 1 };
    const val = { color: C.TEXT, sz: 10, bold: true, indent: 1, wrap: true };
    // Party and bank values span B:E and H:K so they never stretch the timesheet columns.
    // Excel does not auto-fit row height on merged cells, so heights are set once widths are known.
    const wrapped = [];
    const putValue = (col, from, to, value, bg) => {
      put(ws, col + R, value || '', Object.assign({ bg }, val));
      merge(R, from, to);
      if (value) wrapped.push({ r: R, text: String(value), from, to });
    };

    // Title
    rowH[R - 1] = { hpt: 36 };
    fill(R, { bg: C.SECTION_BG });
    put(ws, 'A' + R, 'INVOICE' + (h.invNumber ? '  ' + h.invNumber : ''), { bg: C.SECTION_BG, color: C.SECTION_FG, sz: 20, bold: true, align: 'center' });
    merge(R, 0, NCOLS - 1); R++;

    rowH[R - 1] = { hpt: 14 };
    fill(R, { bg: C.ACCENT_BANNER });
    put(ws, 'A' + R, 'Rates per Commercial Producers Association of South Africa guidelines', { bg: C.ACCENT_BANNER, color: C.ACCENT_DARK, sz: 8, italic: true, align: 'center' });
    merge(R, 0, NCOLS - 1); R++;
    spacer();

    // Parties
    rowH[R - 1] = { hpt: 16 };
    fill(R, { bg: C.SECTION_BG }, 0, 5);
    put(ws, 'A' + R, 'INVOICE TO', { bg: C.SECTION_BG, color: C.SECTION_FG, sz: 9, bold: true, indent: 1 });
    put(ws, 'F' + R, '', { bg: C.WHITE });
    fill(R, { bg: C.SECTION_BG }, 6, 11);
    put(ws, 'G' + R, 'INVOICE FROM', { bg: C.SECTION_BG, color: C.SECTION_FG, sz: 9, bold: true, indent: 1 });
    put(ws, 'L' + R, 'DATE', { bg: C.ACCENT_MID, color: C.ACCENT_DARK, sz: 8, bold: true, align: 'right' });
    put(ws, 'M' + R, h.invDate || '', { bg: C.ACCENT_MID, color: C.ACCENT_DARK, sz: 9, bold: true, align: 'center' });
    R++;

    const toData = [['Company', h.toName], ['Address', h.toAddr], ['Reg No.', h.toReg], ['VAT No.', h.toVat], ['Job / Prod.', h.jobName]];
    const fromData = [['Name', h.fromName], ['Designation', h.fromDesignation], ['Address', h.fromAddr], ['ID/Passport', h.fromId], ['Contact', h.fromContact], ['Tax No.', h.fromTax]];
    for (let i = 0; i < Math.max(toData.length, fromData.length); i++) {
      rowH[R - 1] = { hpt: 15 };
      const bgL = i % 2 === 0 ? C.ACCENT_BG : C.WHITE;
      const bgR = i % 2 === 0 ? C.OFF_WHITE : C.WHITE;
      fill(R, { bg: C.WHITE });
      if (toData[i]) {
        fill(R, { bg: bgL }, 0, 5);
        put(ws, 'A' + R, toData[i][0], Object.assign({ bg: bgL }, lbl));
        putValue('B', 1, 4, toData[i][1], bgL);
      }
      if (fromData[i]) {
        fill(R, { bg: bgR }, 6, 11);
        put(ws, 'G' + R, fromData[i][0], Object.assign({ bg: bgR }, lbl));
        putValue('H', 7, 10, fromData[i][1], bgR);
      }
      R++;
    }

    // Banking
    spacer();
    band('BANKING DETAILS', 9);
    [['Bank', h.bankName], ['Branch Code', h.bankBranch], ['Account Number', h.bankAcc]].forEach((b, i) => {
      rowH[R - 1] = { hpt: 15 };
      const bg = i % 2 === 0 ? C.ACCENT_BG : C.WHITE;
      fill(R, { bg: C.WHITE });
      put(ws, 'A' + R, b[0], Object.assign({ bg }, lbl));
      putValue('B', 1, 4, b[1], bg);
      R++;
    });

    // Day rate
    spacer();
    rowH[R - 1] = { hpt: 22 };
    fill(R, { bg: C.ACCENT_MID });
    put(ws, 'A' + R, 'DAILY RATE', { bg: C.ACCENT_MID, color: C.ACCENT_DARK, sz: 9, bold: true, align: 'right', indent: 1 });
    put(ws, 'B' + R, dr, { bg: C.ACCENT, color: C.WHITE, sz: 14, bold: true, align: 'center', numFmt: RAND });
    put(ws, 'C' + R, 'Hourly R' + hr.toFixed(2) + ' (day rate / 10), overtime after hour ' + base + (base === 12 ? ', 12hr deal' : ''),
      { bg: C.ACCENT_MID, color: C.ACCENT_DARK, sz: 9, italic: true });
    merge(R, 2, NCOLS - 1); R++;

    // Timesheet
    spacer();
    band('SERVICES RENDERED (TIMESHEET)');
    rowH[R - 1] = { hpt: 28 };
    const hdrs = ['DATE', 'DESCRIPTION', 'DAYS', 'x1.5 HRS', 'x1.5 COST', 'x2.0 HRS', 'x2.0 COST', 'x3.0 HRS', 'x3.0 COST', 'T/A HRS', 'T/A COST', 'T/A', 'AMOUNT'];
    const grps = [null, null, null, 'ot', 'ot', 'ot', 'ot', 'ot', 'ot', 'ta', 'ta', 'ta', 'amt'];
    hdrs.forEach((t, i) => {
      const g = grps[i];
      const bg = g === 'ot' ? C.OT_HEAD_BG : g === 'ta' ? C.TA_HEAD_BG : g === 'amt' ? C.SECTION_BG : C.ROW_ALT;
      const fg = g === 'ot' ? C.OT_HEAD_FG : g === 'ta' ? C.TA_HEAD_FG : g === 'amt' ? C.SECTION_FG : C.TEXT_DIM;
      put(ws, colName(i) + R, t, { bg, color: fg, sz: 9, bold: true, align: i <= 1 ? 'left' : 'center', indent: i <= 1 ? 1 : 0, border: true, wrap: true });
    });
    R++;

    const firstDataRow = R;
    inv.lines.forEach(({ row, c }, ri) => {
      rowH[R - 1] = { hpt: 16 };
      const bg = ri % 2 === 0 ? C.WHITE : C.ROW_ALT;
      const cell = { bg, sz: 10, border: true };
      const numCell = (active, fmt) => Object.assign({}, cell, {
        align: 'center', numFmt: fmt,
        bg: active ? C.OT_CELL_BG : bg, color: active ? C.OT_HEAD_FG : C.TEXT_MUTED,
      });

      put(ws, 'A' + R, row.date || '', Object.assign({}, cell, { indent: 1 }));
      put(ws, 'B' + R, row.desc || row.type || '', Object.assign({}, cell, { indent: 1 }));
      put(ws, 'C' + R, c.days, Object.assign({}, cell, { align: 'center' }));

      const timed = (row.type === 'Shoot Day' || row.type === 'Premium Day') && row.call && row.wrap;
      if (timed) {
        const w = round(c.totalHrs, 4);
        const rate = row.type === 'Premium Day' ? (dr * 1.5) / 10 : hr;
        const f15h = 'MIN(MAX(' + w + '-' + base + ',0),' + cap15 + ')';
        const over15 = 'MAX(' + w + '-' + base + '-' + cap15 + ',0)';
        // Premium day x2 has no cap. Shoot day x2 is capped only on the 12hr deal.
        const f2h = row.type === 'Shoot Day' && cap2 !== null ? 'MIN(' + over15 + ',' + cap2 + ')' : over15;
        put(ws, 'D' + R, { f: f15h, v: c.ot15h }, numCell(c.ot15h > 0, HRS));
        put(ws, 'E' + R, { f: 'D' + R + '*' + rate + '*1.5', v: c.ot15c }, numCell(c.ot15h > 0, RAND));
        put(ws, 'F' + R, { f: f2h, v: c.ot2h }, numCell(c.ot2h > 0, HRS));
        put(ws, 'G' + R, { f: 'F' + R + '*' + rate + '*2', v: c.ot2c }, numCell(c.ot2h > 0, RAND));
        if (row.type === 'Shoot Day' && row.pastMidnight && cap2 !== null) {
          put(ws, 'H' + R, { f: 'MAX(' + w + '-' + base + '-' + (cap15 + cap2) + ',0)', v: c.ot3h }, numCell(c.ot3h > 0, HRS));
        } else {
          put(ws, 'H' + R, 0, numCell(false, HRS));
        }
        put(ws, 'I' + R, { f: 'H' + R + '*' + rate + '*3', v: c.ot3c }, numCell(c.ot3h > 0, RAND));
      } else {
        // Zeros, not text: the Amount formula adds these cells and text would give #VALUE!
        ['D', 'F', 'H'].forEach(col => put(ws, col + R, 0, numCell(false, HRS)));
        ['E', 'G', 'I'].forEach(col => put(ws, col + R, 0, numCell(false, RAND)));
      }

      const ta = c.tah > 0;
      const taCell = fmt => Object.assign({}, cell, { align: 'center', numFmt: fmt, bg: ta ? C.TA_CELL_BG : bg, color: ta ? C.TA_HEAD_FG : C.TEXT_MUTED });
      put(ws, 'J' + R, round(c.tah, 4), taCell(HRS));
      put(ws, 'K' + R, round(c.tac, 2), taCell(RAND));
      put(ws, 'L' + R, row.taWarn || '', Object.assign(taCell(), { sz: 9, bold: ta }));

      let f;
      if (row.type === 'Pre-Production' || row.type === 'Post-Production') f = 'C' + R + '*' + dr + '+K' + R;
      else if (row.type === 'Travel Day') f = 'C' + R + '*' + dr + '*0.5';
      else if (row.type === 'Cancellation Day') f = 'C' + R + '*' + dr + '*' + (row.cancelPct === 25 ? 0.25 : 0.5);
      else if (row.type === 'Premium Day') f = dr + '*1.5+E' + R + '+G' + R + '+I' + R + '+K' + R;
      else f = dr + '+E' + R + '+G' + R + '+I' + R + '+K' + R;
      put(ws, 'M' + R, { f, v: c.amount }, Object.assign({}, cell, {
        bg: C.ACCENT_BG, color: c.amount ? C.ACCENT_DARK : C.TEXT_MUTED, sz: 11, bold: c.amount > 0, align: 'right', numFmt: RAND,
      }));
      R++;
    });
    const lastDataRow = R - 1;
    const hasRows = inv.lines.length > 0;
    const sumOf = col => hasRows ? 'SUM(' + col + firstDataRow + ':' + col + lastDataRow + ')' : '0';

    if (inv.taTotal > 0) {
      rowH[R - 1] = { hpt: 15 };
      fill(R, { bg: C.TA_CELL_BG });
      put(ws, 'J' + R, 'T/A penalties (' + inv.taCount + ' violation' + (inv.taCount > 1 ? 's' : '') + ', included above)',
        { bg: C.TA_CELL_BG, color: C.TA_HEAD_FG, sz: 9, italic: true, align: 'right' });
      put(ws, 'M' + R, { f: sumOf('K'), v: inv.taTotal }, { bg: C.TA_HEAD_BG, color: C.TA_HEAD_FG, sz: 10, bold: true, align: 'right', numFmt: RAND, border: true });
      merge(R, 9, 11); R++;
    }
    spacer();

    const totalLine = (label, formula, value, rowBg, lblOpts, valOpts, height) => {
      rowH[R - 1] = { hpt: height || 16 };
      fill(R, { bg: rowBg });
      // J is the top-left of the J:L merge, the only cell Excel displays
      put(ws, 'J' + R, label, Object.assign({ bg: rowBg, sz: 9, align: 'right' }, lblOpts));
      put(ws, 'M' + R, { f: formula, v: value }, Object.assign({ bg: rowBg, sz: 10, bold: true, align: 'right', numFmt: RAND, border: true }, valOpts));
      merge(R, 9, 11);
      return R++;
    };
    const subtotalRow = totalLine('Subtotal, taxable', sumOf('M'), inv.taxable, C.SUB_BG, { color: C.TEXT_DIM }, { color: C.ACCENT_DARK, sz: 11 });
    const totalRow = totalLine('TOTAL TAXABLE', 'M' + subtotalRow, inv.taxable, C.TOTAL_BG, { color: C.ACCENT_DARK, sz: 10, bold: true }, { bg: C.ACCENT, color: C.WHITE, sz: 13 }, 20);
    const payeRow = totalLine('Less: PAYE 25%', 'M' + totalRow + '*' + core.PAYE_RATE, inv.paye, C.PAYE_BG, { color: C.PAYE_FG, italic: true }, { color: C.PAYE_FG });
    const netRow = totalLine('Net taxable (after PAYE)', 'M' + totalRow + '-M' + payeRow, inv.netTaxable, C.SUB_BG, { color: C.TEXT_DIM }, { color: C.TEXT });

    // Extras
    spacer();
    band('EXTRAS: NON-TAXABLE ALLOWANCES');
    rowH[R - 1] = { hpt: 16 };
    ['ITEM', '', 'DAYS', '', 'RATE (R/day)', '', '', '', '', '', '', '', 'AMOUNT'].forEach((t, ci) => {
      put(ws, colName(ci) + R, t, { bg: C.GREEN_HEAD, color: C.GREEN_FG, sz: 9, bold: true, align: ci === 0 ? 'left' : ci === 12 ? 'right' : 'center', indent: ci === 0 ? 1 : 0, border: true });
    });
    merge(R, 0, 1); merge(R, 2, 3); merge(R, 4, 11); R++;

    const firstExtRow = R;
    inv.extras.forEach((e, ei) => {
      rowH[R - 1] = { hpt: 16 };
      const bg = ei % 2 === 0 ? C.GREEN_BG : C.WHITE;
      fill(R, { bg, border: true });
      put(ws, 'A' + R, e.label, { bg, sz: 10, indent: 1, border: true });
      put(ws, 'C' + R, e.days, { bg, color: e.days ? C.TEXT : C.TEXT_MUTED, sz: 10, align: 'center', border: true });
      put(ws, 'E' + R, e.rate, { bg, color: e.rate ? C.TEXT : C.TEXT_MUTED, sz: 10, align: 'center', numFmt: RAND, border: true });
      put(ws, 'M' + R, { f: 'C' + R + '*E' + R, v: e.amount }, { bg, color: e.amount ? C.GREEN_FG : C.TEXT_MUTED, sz: 10, bold: e.amount > 0, align: 'right', numFmt: RAND, border: true });
      merge(R, 0, 1); merge(R, 2, 3); merge(R, 4, 11); R++;
    });
    const extSubRow = totalLine('EXTRAS SUBTOTAL', 'SUM(M' + firstExtRow + ':M' + (R - 1) + ')', inv.extrasTotal, C.GREEN_HEAD, { color: C.GREEN_FG, bold: true }, { color: C.GREEN_FG, sz: 11 });

    // Grand total
    spacer();
    rowH[R - 1] = { hpt: 32 };
    fill(R, { bg: C.ACCENT }, 0, 12);
    put(ws, 'A' + R, 'GRAND TOTAL (NET OF PAYE)', { bg: C.ACCENT, color: C.WHITE, sz: 16, bold: true, indent: 1 });
    put(ws, 'M' + R, { f: 'M' + netRow + '+M' + extSubRow, v: inv.grand }, { bg: C.ACCENT, color: C.WHITE, sz: 16, bold: true, align: 'right', numFmt: RAND });
    merge(R, 0, 11); R++;

    rowH[R - 1] = { hpt: 13 };
    fill(R, { bg: C.ACCENT_MID });
    put(ws, 'A' + R, 'Net taxable ' + core.formatRand(inv.netTaxable) + ' + non-taxable extras ' + core.formatRand(inv.extrasTotal),
      { bg: C.ACCENT_MID, color: C.ACCENT_DARK, sz: 8, italic: true, indent: 1 });
    merge(R, 0, NCOLS - 1); R++;

    spacer();
    rowH[R - 1] = { hpt: 14 };
    fill(R, { bg: C.OFF_WHITE });
    const otRule = base === 12
      ? '12hr deal: hrs 13-14 x1.5, hrs 15-18 x2.0.'
      : 'Standard day = 10hrs: hrs 11-14 x1.5, hrs 15+ x2.0.';
    put(ws, 'A' + R, 'CPA guidelines. ' + otRule + ' T/A penalty: first 2hrs x1, next 2hrs x2, thereafter x3 pro rata. PAYE deducted by production.',
      { bg: C.OFF_WHITE, color: C.TEXT_MUTED, sz: 8, italic: true, indent: 1 });
    merge(R, 0, NCOLS - 1);

    // Excel cannot auto-fit a column on open, so B is sized from its longest timesheet description.
    // Text inside a multi-column merge (party values, headings) belongs to the merge and is skipped.
    const inMerge = (r, c) => merges.some(m => m.s.c !== m.e.c && r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
    const fitWidth = (col, min, max) => {
      const c = col.charCodeAt(0) - 65;
      let longest = 0;
      Object.keys(ws).forEach(addr => {
        const m = /^([A-Z]+)(\d+)$/.exec(addr);
        if (!m || m[1] !== col) return;
        const cell = ws[addr];
        if (cell.f || cell.v === '' || cell.v == null || inMerge(Number(m[2]) - 1, c)) return;
        const bold = cell.s && cell.s.font && cell.s.font.bold;
        longest = Math.max(longest, String(cell.v).length * (bold ? 1.1 : 1));
      });
      return Math.min(Math.max(min, Math.ceil(longest) + 2), max);
    };

    const widths = [13, 26, 6, 7, 11, 7, 11, 11, 11, 7, 11, 6, 13];
    widths[1] = fitWidth('B', 26, 80);

    const lineCount = ({ text, from, to }) => {
      let span = 0;
      for (let c = from; c <= to; c++) span += widths[c];
      return Math.ceil((text.length * 1.1) / Math.max(span - 2, 1));
    };
    const linesByRow = {};
    wrapped.forEach(w => { linesByRow[w.r] = Math.max(linesByRow[w.r] || 1, lineCount(w)); });
    Object.keys(linesByRow).forEach(r => { if (linesByRow[r] > 1) rowH[r - 1] = { hpt: 15 * linesByRow[r] }; });

    ws['!ref'] = 'A1:' + colName(NCOLS - 1) + R;
    ws['!merges'] = merges;
    ws['!rows'] = rowH;
    ws['!cols'] = widths.map(wch => ({ wch }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
    const filename = [
      core.safeFileSegment(h.invNumber, 'Invoice'),
      core.safeFileSegment(h.fromName, 'Crew'),
      core.safeFileSegment(h.jobName, 'Production'),
    ].join('_') + '.xlsx';
    return { wb, filename };
  }

  return { buildWorkbook, COLORS: C };
});
