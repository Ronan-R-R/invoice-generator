// Builds the A4 print sheet used for PDF export. Styles live in css/styles.css under .print-sheet.
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.InvoiceCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoicePrint = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const esc = core.escapeHtml;
  const R = core.formatRand;
  const DASH = '-';

  function orDash(v) { return v ? esc(v) : DASH; }
  function money(n) { return n > 0 ? R(n) : DASH; }
  function hours(n, suffix) { return n > 0 ? n.toFixed(2) + (suffix || '') : DASH; }

  function partyRows(pairs) {
    return pairs.map(([label, value]) =>
      '<div class="ps-pr"><span class="ps-pl">' + esc(label) + '</span><span class="ps-pv">' + orDash(value) + '</span></div>'
    ).join('');
  }

  function section(n, title) {
    return '<div class="ps-sec"><span class="ps-sec-n">' + n + '</span><h2 class="ps-sec-t">' + esc(title) + '</h2><span class="ps-sec-l"></span></div>';
  }

  function buildPrintHtml(data) {
    const h = data.header;
    const inv = data.invoice;
    const base = inv.baseHours;

    const rows = inv.lines.map(({ row, c }) => {
      const dim = cond => cond ? '' : ' class="ps-dim"';
      // Travel and cancellation rows keep default times in state but never use them
      const timed = core.TIMED_TYPES.includes(row.type);
      const call = timed ? row.call : '';
      const wrap = timed ? row.wrap : '';
      return '<tr>' +
        '<td class="ps-left">' + orDash(row.date) + '</td>' +
        '<td class="ps-left">' + esc(row.desc || row.type) + '</td>' +
        '<td>' + esc(c.days) + '</td>' +
        '<td' + dim(call) + '>' + orDash(call) + '</td>' +
        '<td' + dim(wrap) + '>' + orDash(wrap) + '</td>' +
        '<td' + dim(c.totalHrs > 0) + '>' + (c.totalHrs > 0 ? c.totalHrs.toFixed(1) + 'h' : DASH) + '</td>' +
        '<td' + dim(c.ot15h > 0) + '>' + hours(c.ot15h) + '</td>' +
        '<td' + dim(c.ot15c > 0) + '>' + money(c.ot15c) + '</td>' +
        '<td' + dim(c.ot2h > 0) + '>' + hours(c.ot2h) + '</td>' +
        '<td' + dim(c.ot2c > 0) + '>' + money(c.ot2c) + '</td>' +
        '<td' + dim(c.ot3h > 0) + '>' + hours(c.ot3h) + '</td>' +
        '<td' + dim(c.ot3c > 0) + '>' + money(c.ot3c) + '</td>' +
        '<td' + (row.taWarn ? ' class="ps-warn"' : ' class="ps-dim"') + '>' + hours(c.tah, 'h') + (row.taWarn ? ' <b>T/A</b>' : '') + '</td>' +
        '<td' + dim(c.tac > 0) + '>' + money(c.tac) + '</td>' +
        '<td class="ps-amt">' + R(c.amount) + '</td>' +
      '</tr>';
    }).join('');

    const empty = inv.lines.length ? '' : '<tr><td colspan="15" class="ps-dim">No days entered</td></tr>';

    const extras = inv.extras.map(e =>
      '<div class="ps-ext-row"><span>' + esc(e.label) + '</span><span class="ps-r">' + esc(e.days) + '</span>' +
      '<span class="ps-r">' + R(e.rate) + '</span><span class="ps-r' + (e.amount > 0 ? ' ps-green' : ' ps-dim') + '">' + money(e.amount) + '</span></div>'
    ).join('');

    return '' +
      '<header class="ps-title">' +
        '<div><h1>Invoice</h1><p class="ps-sub">' + orDash(h.fromName) + (h.jobName ? ' &middot; ' + esc(h.jobName) : '') + '</p></div>' +
        '<dl class="ps-meta">' +
          '<div><dt>Invoice no.</dt><dd>' + orDash(h.invNumber) + '</dd></div>' +
          '<div><dt>Date</dt><dd>' + orDash(h.invDate) + '</dd></div>' +
        '</dl>' +
      '</header>' +

      section(1, 'Invoice parties') +
      '<div class="ps-parties">' +
        '<div><div class="ps-ph">To: production</div>' +
          partyRows([['Company', h.toName], ['Address', h.toAddr], ['Reg No.', h.toReg], ['VAT No.', h.toVat], ['Job', h.jobName]]) + '</div>' +
        '<div><div class="ps-ph">From: crew member</div>' +
          partyRows([['Name', h.fromName], ['Designation', h.fromDesignation], ['Address', h.fromAddr], ['ID/Passport', h.fromId], ['Contact', h.fromContact], ['Tax No.', h.fromTax]]) + '</div>' +
      '</div>' +

      section(2, 'Banking details') +
      '<div class="ps-bank">' +
        [['Bank', h.bankName], ['Branch code', h.bankBranch], ['Account no.', h.bankAcc]]
          .map(([l, v]) => '<span class="ps-bl">' + l + '</span><span class="ps-bv">' + orDash(v) + '</span>').join('') +
      '</div>' +

      '<div class="ps-rate"><span class="ps-rl">Daily rate</span><span class="ps-rv">' + R(inv.dailyRate) + '</span>' +
        '<span class="ps-rn">Hourly ' + R(inv.hourlyRate) + ' (day rate / 10), OT after hour ' + base + (base === 12 ? ', 12hr deal' : '') + '</span></div>' +

      section(3, 'Services rendered') +
      '<table class="ps-table"><colgroup>' +
        '<col class="ps-c-date"><col><col class="ps-c-days"><col class="ps-c-time"><col class="ps-c-time"><col class="ps-c-time">' +
        '<col class="ps-c-h"><col class="ps-c-r"><col class="ps-c-h"><col class="ps-c-r"><col class="ps-c-h"><col class="ps-c-r">' +
        '<col class="ps-c-ta"><col class="ps-c-r"><col class="ps-c-amt">' +
      '</colgroup><thead><tr>' +
        '<th class="ps-left">Date</th><th class="ps-left">Description</th><th>Days</th><th>Call</th><th>Wrap</th><th>Hrs</th>' +
        '<th class="ps-ot">x1.5h</th><th class="ps-ot">x1.5 R</th><th class="ps-ot">x2.0h</th><th class="ps-ot">x2.0 R</th>' +
        '<th class="ps-ot">x3.0h</th><th class="ps-ot">x3.0 R</th><th class="ps-ta">T/A h</th><th class="ps-ta">T/A R</th>' +
        '<th class="ps-amt-h">Amount</th>' +
      '</tr></thead><tbody>' + rows + empty + '</tbody></table>' +

      '<div class="ps-tot">' +
        (inv.taTotal > 0 ? '<div class="ps-tr ps-ta-line"><span>T/A penalties (' + inv.taCount + ' violation' + (inv.taCount > 1 ? 's' : '') + ', included above)</span><span>' + R(inv.taTotal) + '</span></div>' : '') +
        '<div class="ps-tr ps-subt"><span>Subtotal, taxable days</span><span>' + R(inv.taxable) + '</span></div>' +
        '<div class="ps-tr ps-total"><span>Total taxable</span><span>' + R(inv.taxable) + '</span></div>' +
        '<div class="ps-tr ps-paye"><span>Less: PAYE 25% (deducted by production)</span><span>&minus; ' + R(inv.paye) + '</span></div>' +
        '<div class="ps-tr ps-net"><span>Net taxable (after PAYE)</span><span>' + R(inv.netTaxable) + '</span></div>' +
      '</div>' +

      section(4, 'Extras: non-taxable allowances') +
      '<div class="ps-ext-head"><span>Item</span><span class="ps-r">Days</span><span class="ps-r">Rate R/day</span><span class="ps-r">Amount</span></div>' +
      extras +
      '<div class="ps-ext-sub"><span>Extras subtotal</span><span>' + R(inv.extrasTotal) + '</span></div>' +

      '<div class="ps-grand"><span class="ps-gl">Grand total</span><span class="ps-gv">' + R(inv.grand) + '</span></div>' +
      '<div class="ps-gn">Net taxable ' + R(inv.netTaxable) + ' + non-taxable extras ' + R(inv.extrasTotal) + ' &middot; net of PAYE</div>' +
      '<footer class="ps-footer">All calculations per CPA guidelines &middot; base day ' + base + 'hrs' + (base === 12 ? ' (12hr deal)' : '') + ' &middot; PAYE deducted by production</footer>';
  }

  return { buildPrintHtml };
});
