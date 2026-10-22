// Pure invoice logic shared by the browser app and the Node test suite.
// No DOM access in this file.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoiceCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['Shoot Day', 'Premium Day', 'Pre-Production', 'Post-Production', 'Travel Day', 'Cancellation Day'];
  const TIMED_TYPES = ['Shoot Day', 'Premium Day', 'Pre-Production', 'Post-Production'];
  const DAY_COUNT_TYPES = ['Pre-Production', 'Post-Production', 'Travel Day', 'Cancellation Day'];
  const PAYE_RATE = 0.25;

  const EXTRAS = [
    { key: 'toolbox', label: 'Toolbox / kit rental', defaultRate: 250 },
    { key: 'vehicle', label: 'Vehicle / car allowance', defaultRate: 550 },
    { key: 'cell', label: 'Cell phone allowance', defaultRate: 80 },
    { key: 'meals', label: 'Lunches / meals', defaultRate: 100 },
  ];

  const HEADER_FIELDS = [
    'toName', 'toAddr', 'toReg', 'toVat', 'jobName', 'invDate',
    'fromName', 'fromDesignation', 'fromAddr', 'fromId', 'fromContact', 'fromTax',
    'invNumber', 'bankName', 'bankBranch', 'bankAcc',
  ];
  const CREW_FIELDS = ['name', 'designation', 'addr', 'id', 'contact', 'tax', 'bank', 'branch', 'acc', 'rate'];
  const PRODUCTION_FIELDS = ['companyName', 'addr', 'reg', 'vat'];

  const MAX_TEXT = 200;
  const MAX_ROWS = 400;
  const MAX_DIRECTORY = 500;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------------------------------------------------------- time

  function toMins(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  // Accepts "8", "0800", "8.15", "21:30", "24:00" and snaps to 15-minute steps.
  // Returns null for anything that is not a real clock time.
  function parseTimeInput(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const trimmed = raw.trim();
    if (trimmed.length > 8 || /[^0-9:.\s]/.test(trimmed)) return null;
    const str = trimmed.replace('.', ':').replace(/\s/g, '');
    if (!str || str === ':') return null;
    let h, m;
    if (str.includes(':')) {
      const parts = str.split(':');
      if (parts.length !== 2 || parts[0] === '') return null;
      h = Number(parts[0]);
      m = parts[1] === '' ? 0 : Number(parts[1]);
    } else if (str.length <= 2) {
      h = Number(str); m = 0;
    } else if (str.length <= 4) {
      h = Number(str.slice(0, -2));
      m = Number(str.slice(-2));
    } else {
      return null;
    }
    if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
    if (h === 24 && m === 0) h = 0; // crews write midnight wrap as 24:00
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    m = Math.round(m / 15) * 15;
    if (m === 60) { m = 0; h = (h + 1) % 24; }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // ---------------------------------------------------------------- rates

  function numOr(value, fallback) {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  function emptyCalc(days, amount, tah, tac) {
    return { days, totalHrs: 0, ot15h: 0, ot15c: 0, ot2h: 0, ot2c: 0, ot3h: 0, ot3c: 0, tah, tac, amount };
  }

  // Hourly rate is always daily rate / 10. baseHours (10 or 12) only moves the overtime threshold.
  function calcRow(row, dailyRate, baseHours) {
    const dr = dailyRate;
    const base = baseHours === 12 ? 12 : 10;
    const hr = dr / 10;
    const tah = row.tah || 0;
    const tac = row.tac || 0;

    if (row.type === 'Pre-Production' || row.type === 'Post-Production') {
      const days = numOr(row.days, 0);
      return emptyCalc(days, days * dr + tac, tah, tac);
    }
    if (row.type === 'Travel Day') {
      // CPA: travel day is half the day rate
      const days = numOr(row.days, 1);
      return emptyCalc(days, days * dr * 0.5, 0, 0);
    }
    if (row.type === 'Cancellation Day') {
      // CPA: 50% or 25% of the day rate depending on notice given
      const days = numOr(row.days, 1);
      const pct = row.cancelPct === 25 ? 25 : 50;
      return emptyCalc(days, days * dr * (pct / 100), 0, 0);
    }

    const callM = toMins(row.call);
    const wrapM = toMins(row.wrap);

    if (row.type === 'Premium Day') {
      // CPA: Sunday, public holiday or first night shoot is 1.5x the day rate, and OT is on the premium hourly
      const premBase = dr * 1.5;
      const premHr = premBase / 10;
      if (callM === null || wrapM === null) {
        return Object.assign(emptyCalc(1, premBase + tac, tah, tac), { isPremium: true });
      }
      let worked = wrapM - callM;
      if (worked < 0) worked += 1440;
      const workedHrs = worked / 60;
      const cap15 = base === 12 ? 2 : 4;
      const otTotal = Math.max(workedHrs - base, 0);
      const ot15h = Math.min(otTotal, cap15);
      const ot2h = Math.max(otTotal - cap15, 0);
      const ot15c = ot15h * premHr * 1.5;
      const ot2c = ot2h * premHr * 2.0;
      return {
        days: 1, totalHrs: workedHrs, ot15h, ot15c, ot2h, ot2c, ot3h: 0, ot3c: 0,
        tah, tac, amount: premBase + ot15c + ot2c + tac, isPremium: true,
      };
    }

    // Shoot Day.
    // 10hr standard: 4 OT hrs at x1.5, then x2 with no cap.
    // 12hr deal:     2 OT hrs at x1.5, then 4 hrs at x2.
    // x3 only applies past midnight on the last shoot day (row.pastMidnight).
    if (callM === null || wrapM === null) {
      return emptyCalc(1, dr + tac, tah, tac);
    }
    let worked = wrapM - callM;
    if (worked < 0) worked += 1440;
    const workedHrs = worked / 60;
    const cap15 = base === 12 ? 2 : 4;
    const cap2 = base === 12 ? 4 : Infinity;
    const otTotal = Math.max(workedHrs - base, 0);
    const ot15h = Math.min(otTotal, cap15);
    const ot2h = Math.min(Math.max(otTotal - cap15, 0), cap2);
    const ot3h = row.pastMidnight ? Math.max(otTotal - cap15 - cap2, 0) : 0;
    const ot15c = ot15h * hr * 1.5;
    const ot2c = ot2h * hr * 2.0;
    const ot3c = ot3h * hr * 3.0;
    return { days: 1, totalHrs: workedHrs, ot15h, ot15c, ot2h, ot2c, ot3h, ot3c, tah, tac, amount: dr + ot15c + ot2c + ot3c + tac };
  }

  function dayNumber(dateStr) {
    if (!dateStr || !DATE_RE.test(dateStr)) return null;
    const d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d)) return null;
    return Math.floor(d.getTime() / 86400000);
  }

  // Sets tah / tac / taWarn on each row in place.
  // A turnaround under 10 hours between consecutive timed days is penalised:
  // first 2 hrs x1, next 2 hrs x2, thereafter x3 pro rata hourly.
  function calcTurnaround(rows, dailyRate) {
    const hr = dailyRate / 10;
    for (let i = 0; i < rows.length; i++) {
      rows[i].tah = 0;
      rows[i].tac = 0;
      rows[i].taWarn = '';
      if (!TIMED_TYPES.includes(rows[i].type)) continue;
      if (!rows[i].call || !rows[i].wrap) continue;

      for (let j = i - 1; j >= 0; j--) {
        if (!TIMED_TYPES.includes(rows[j].type)) continue;
        if (!rows[j].call || !rows[j].wrap) continue;

        const prevWrapM = toMins(rows[j].wrap);
        const currCallM = toMins(rows[i].call);
        if (prevWrapM === null || currCallM === null) break;

        const prevDay = dayNumber(rows[j].date);
        const currDay = dayNumber(rows[i].date);
        if (prevDay !== null && currDay !== null) {
          const gap = currDay - prevDay;
          if (gap > 1 || gap < 0) break; // a free day in between, or rows out of order
        }

        let gapMins = currCallM - prevWrapM;
        if (gapMins < 0) gapMins += 1440;
        const gapHrs = gapMins / 60;

        if (gapHrs < 10) {
          const shortfall = 10 - gapHrs;
          const tier1 = Math.min(shortfall, 2);
          const tier2 = Math.min(Math.max(shortfall - 2, 0), 2);
          const tier3 = Math.max(shortfall - 4, 0);
          rows[i].tah = shortfall;
          rows[i].tac = tier1 * hr + tier2 * hr * 2 + tier3 * hr * 3;
          rows[i].taWarn = 'T/A';
        }
        break;
      }
    }
    return rows;
  }

  // Everything both exports and the on-screen totals need, from one state object.
  function computeInvoice(state) {
    const dr = numOr(state.dailyRate, 0);
    const base = state.baseHours === 12 ? 12 : 10;
    const rows = calcTurnaround((state.rows || []).map(r => Object.assign({}, r)), dr);
    const lines = rows.map(row => ({ row, c: calcRow(row, dr, base) }));

    let taxable = 0, taTotal = 0, taCount = 0;
    lines.forEach(({ row, c }) => {
      taxable += c.amount;
      if (row.tac > 0) { taTotal += row.tac; taCount++; }
    });

    const extrasState = state.extras || {};
    const extras = EXTRAS.map(e => {
      const item = extrasState[e.key] || {};
      const days = Math.max(numOr(item.days, 0), 0);
      const rate = Math.max(numOr(item.rate, e.defaultRate), 0);
      return { key: e.key, label: e.label, days, rate, amount: days * rate };
    });
    const extrasTotal = extras.reduce((s, e) => s + e.amount, 0);
    const paye = taxable * PAYE_RATE;

    return {
      dailyRate: dr, baseHours: base, hourlyRate: dr / 10,
      lines, taxable, paye, netTaxable: taxable - paye,
      extras, extrasTotal, grand: taxable - paye + extrasTotal,
      taTotal, taCount,
    };
  }

  // ---------------------------------------------------------------- formatting

  function formatRand(n) {
    return 'R ' + Math.round(n || 0).toLocaleString('en-ZA');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function localDateISO(d) {
    const date = d || new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function safeFileSegment(s, fallback) {
    const clean = String(s || '').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    return clean || fallback;
  }

  // ---------------------------------------------------------------- invoice numbers

  const PREFIX_RE = /^[A-Z0-9]{1,10}$/;
  const DEFAULT_SEQUENCE = { prefix: 'INV', next: 1 };

  function sanitizeSequence(raw) {
    const out = Object.assign({}, DEFAULT_SEQUENCE);
    if (raw && typeof raw === 'object') {
      const prefix = typeof raw.prefix === 'string' ? raw.prefix.trim().toUpperCase() : '';
      if (PREFIX_RE.test(prefix)) out.prefix = prefix;
      const next = Number(raw.next);
      if (Number.isInteger(next) && next >= 1 && next <= 999999) out.next = next;
    }
    return out;
  }

  function invoiceYear(invDate) {
    return invDate && DATE_RE.test(invDate) ? invDate.slice(0, 4) : String(new Date().getFullYear());
  }

  function formatInvoiceNumber(seq, invDate) {
    return seq.prefix + '-' + invoiceYear(invDate) + '-' + String(seq.next).padStart(4, '0');
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // True when the number is an unissued auto preview, so it can follow date or sequence changes.
  function isAutoNumber(number, seq) {
    const re = new RegExp('^' + escapeRegex(seq.prefix) + '-\\d{4}-' + String(seq.next).padStart(4, '0') + '$');
    return re.test(number || '');
  }

  // Called when an invoice is exported for the first time. The counter moves past
  // whatever number was used, so a hand-typed INV-2026-0050 makes the next one 0051.
  // Numbers in some other format leave the counter alone.
  function advanceSequence(seq, usedNumber) {
    const re = new RegExp('^' + escapeRegex(seq.prefix) + '-\\d{4}-(\\d{1,6})$');
    const m = re.exec((usedNumber || '').trim());
    if (!m) return Object.assign({}, seq);
    const used = parseInt(m[1], 10);
    return Object.assign({}, seq, { next: Math.min(Math.max(seq.next, used + 1), 999999) });
  }

  // ---------------------------------------------------------------- validation of untrusted input

  function text(v, max) {
    return typeof v === 'string' ? v.slice(0, max || MAX_TEXT) : (typeof v === 'number' ? String(v) : '');
  }

  function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  }

  function sanitizeRow(raw, id) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const type = TYPES.includes(r.type) ? r.type : 'Shoot Day';
    return {
      id,
      date: typeof r.date === 'string' && DATE_RE.test(r.date) ? r.date : '',
      desc: text(r.desc),
      type,
      call: parseTimeInput(text(r.call, 8)) || '',
      wrap: parseTimeInput(text(r.wrap, 8)) || '',
      days: clampNum(r.days, 0, 365, 1),
      cancelPct: r.cancelPct === 25 ? 25 : 50,
      pastMidnight: r.pastMidnight === true,
    };
  }

  // Session files and autosave are untrusted: a .cpa file can come from anyone.
  // Rebuild the state from an allowlist instead of trusting the object.
  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a session object');
    if (raw.version !== 1 && raw.version !== 2) throw new Error('Unsupported session version');
    if (!raw.header || typeof raw.header !== 'object') throw new Error('Session has no header');

    const header = {};
    HEADER_FIELDS.forEach(k => { header[k] = text(raw.header[k]); });
    if (!DATE_RE.test(header.invDate)) header.invDate = '';
    header.invNumber = header.invNumber.slice(0, 40);

    const rawRows = Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_ROWS) : [];
    const rows = rawRows.map((r, i) => sanitizeRow(r, i + 1));

    // v1 stored extras flat (toolboxDays / toolboxRate), v2 nests them by key
    const rawExtras = raw.extras && typeof raw.extras === 'object' ? raw.extras : {};
    const extras = {};
    EXTRAS.forEach(e => {
      const nested = rawExtras[e.key] && typeof rawExtras[e.key] === 'object' ? rawExtras[e.key] : null;
      const days = nested ? nested.days : rawExtras[e.key + 'Days'];
      const rate = nested ? nested.rate : rawExtras[e.key + 'Rate'];
      extras[e.key] = { days: clampNum(days, 0, 365, 0), rate: clampNum(rate, 0, 1e6, e.defaultRate) };
    });

    return {
      version: 2,
      header,
      invIssued: raw.invIssued === true,
      dailyRate: clampNum(raw.dailyRate, 0, 1e7, 2000),
      baseHours: Number(raw.baseHours) === 12 ? 12 : 10,
      rows,
      extras,
    };
  }

  function sanitizeDirectoryEntries(list, type) {
    const fields = type === 'crew' ? CREW_FIELDS : PRODUCTION_FIELDS;
    const key = type === 'crew' ? 'name' : 'companyName';
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_DIRECTORY)
      .filter(e => e && typeof e === 'object')
      .map(e => {
        const out = {};
        fields.forEach(f => { out[f] = text(e[f]).trim(); });
        if (type === 'crew') out.rate = out.rate && !isNaN(parseFloat(out.rate)) ? String(clampNum(out.rate, 0, 1e7, 0)) : '';
        return out;
      })
      .filter(e => e[key]);
  }

  function sanitizeDirectoryFile(raw) {
    if (!raw || typeof raw !== 'object' || raw.kind !== 'invoice-generator-directory') {
      throw new Error('Not a directory export');
    }
    return {
      crew: sanitizeDirectoryEntries(raw.crew, 'crew'),
      production: sanitizeDirectoryEntries(raw.production, 'production'),
    };
  }

  // Imported entries replace existing ones with the same name, everything else is kept.
  function mergeDirectory(existing, incoming, type) {
    const key = type === 'crew' ? 'name' : 'companyName';
    const out = existing.slice();
    incoming.forEach(entry => {
      const idx = out.findIndex(e => e[key] === entry[key]);
      if (idx >= 0) out[idx] = entry; else out.push(entry);
    });
    return out.slice(0, MAX_DIRECTORY);
  }

  return {
    TYPES, TIMED_TYPES, DAY_COUNT_TYPES, EXTRAS, PAYE_RATE, HEADER_FIELDS, MAX_ROWS,
    toMins, parseTimeInput, calcRow, calcTurnaround, computeInvoice,
    formatRand, escapeHtml, localDateISO, safeFileSegment,
    sanitizeSequence, formatInvoiceNumber, isAutoNumber, advanceSequence,
    sanitizeState, sanitizeRow, sanitizeDirectoryEntries, sanitizeDirectoryFile, mergeDirectory,
  };
});
