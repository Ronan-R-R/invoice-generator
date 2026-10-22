(function () {
  'use strict';

  const core = window.InvoiceCore;
  const esc = core.escapeHtml;
  const R = core.formatRand;
  const $ = id => document.getElementById(id);

  const KEYS = {
    autosave: 'ig_invoice_autosave',
    seq: 'ig_invoice_sequence',
    crew: 'ig_dir_crew',
    production: 'ig_dir_production',
  };
  // Keys used by the original single-file version, read once so local users keep their data
  const LEGACY_KEYS = { autosave: 'cpa_invoice_autosave', crew: 'cpa_dir_crew', production: 'cpa_dir_production' };
  const MAX_FILE_BYTES = 1024 * 1024;

  const FIELD_IDS = {
    toName: 'to-name', toAddr: 'to-addr', toReg: 'to-reg', toVat: 'to-vat', jobName: 'job-name', invDate: 'inv-date',
    fromName: 'from-name', fromDesignation: 'from-designation', fromAddr: 'from-addr', fromId: 'from-id',
    fromContact: 'from-contact', fromTax: 'from-tax', invNumber: 'inv-number',
    bankName: 'bank-name', bankBranch: 'bank-branch', bankAcc: 'bank-acc',
  };

  const CALC_LABELS = {
    hrs: 'Hours', ot15h: 'x1.5 hrs', ot15c: 'x1.5 cost', ot2h: 'x2.0 hrs', ot2c: 'x2.0 cost',
    ot3h: 'x3.0 hrs', ot3c: 'x3.0 cost', tah: 'T/A hrs', tac: 'T/A cost',
  };

  // ------------------------------------------------------------ storage

  const store = {
    read(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? null : JSON.parse(raw);
      } catch (e) { return null; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* storage blocked: nothing to remove */ }
    },
    keys() {
      try { return Object.keys(localStorage); } catch (e) { return []; }
    },
  };

  // ------------------------------------------------------------ state

  let rows = [];
  let nextId = 1;
  let baseHours = 10;
  let invIssued = false;
  let seq = core.sanitizeSequence(store.read(KEYS.seq));
  let suppressAutosave = false;

  const tbody = $('ts-body');

  function newRow(overrides) {
    return Object.assign({
      id: nextId++, date: '', desc: '', type: 'Shoot Day', call: '07:00', wrap: '17:00',
      days: 1, cancelPct: 50, pastMidnight: false,
    }, overrides);
  }

  function getDailyRate() {
    const n = parseFloat($('daily-rate').value);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function readHeader() {
    const h = {};
    Object.keys(FIELD_IDS).forEach(k => { h[k] = $(FIELD_IDS[k]).value; });
    return h;
  }

  function readExtras() {
    const out = {};
    core.EXTRAS.forEach(e => {
      const days = parseFloat($('e-' + e.key + '-days').value);
      const rate = parseFloat($('e-' + e.key + '-rate').value);
      out[e.key] = { days: isNaN(days) ? 0 : days, rate: isNaN(rate) ? 0 : rate };
    });
    return out;
  }

  function invoice() {
    return core.computeInvoice({ dailyRate: getDailyRate(), baseHours, rows, extras: readExtras() });
  }

  function previewNumber() {
    return core.formatInvoiceNumber(seq, $('inv-date').value);
  }

  // ------------------------------------------------------------ toast

  let toastTimer = null;
  function toast(msg, tone) {
    const t = $('toast');
    t.textContent = msg;
    t.dataset.tone = tone || 'info';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), tone === 'error' ? 6500 : 3500);
  }

  // ------------------------------------------------------------ autosave

  let autosaveTimer = null;

  function setAutosave(state, label) {
    $('autosave').dataset.state = state;
    $('autosave-label').textContent = label;
  }

  function gatherState() {
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      header: readHeader(),
      invIssued,
      dailyRate: getDailyRate(),
      baseHours,
      rows: rows.map(r => ({
        id: r.id, date: r.date, desc: r.desc, type: r.type, call: r.call, wrap: r.wrap,
        days: r.days, cancelPct: r.cancelPct, pastMidnight: r.pastMidnight,
      })),
      extras: readExtras(),
    };
  }

  function saveNow() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (suppressAutosave) return;
    if (store.write(KEYS.autosave, gatherState())) {
      const t = new Date();
      setAutosave('saved', 'Saved ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
    } else {
      setAutosave('error', 'Autosave blocked by this browser');
    }
  }

  function scheduleAutosave() {
    if (suppressAutosave) return;
    clearTimeout(autosaveTimer);
    setAutosave('pending', 'Saving...');
    autosaveTimer = setTimeout(saveNow, 800);
  }

  // ------------------------------------------------------------ invoice number

  function updateInvStatus() {
    const el = $('inv-status');
    const v = $('inv-number').value.trim();
    if (invIssued) {
      el.dataset.state = 'issued';
      el.textContent = 'Issued. Exporting again keeps this number.';
    } else if (core.isAutoNumber(v, seq)) {
      el.dataset.state = 'auto';
      el.textContent = 'Next in sequence. Used up on first export.';
    } else {
      el.dataset.state = 'custom';
      el.textContent = 'Custom number. Used as typed on export.';
    }
  }

  function numberForExport() {
    return $('inv-number').value.trim() || previewNumber();
  }

  // Runs after an export succeeds, so a failed export never burns a number.
  function commitNumber(number) {
    $('inv-number').value = number;
    if (!invIssued) {
      seq = core.advanceSequence(seq, number);
      if (!store.write(KEYS.seq, seq)) toast('This browser blocked storage, so the next invoice number may repeat.', 'error');
      invIssued = true;
    }
    updateInvStatus();
    saveNow();
  }

  // ------------------------------------------------------------ timesheet rendering

  function cancelHtml(row, n) {
    const pct = row.cancelPct === 25 ? 25 : 50;
    return '<div class="cancel">' +
      '<div class="cancel-toggle" role="group" aria-label="Cancellation rate, day ' + n + '">' +
        '<button type="button" data-action="cancel-pct" data-pct="50" aria-pressed="' + (pct === 50) + '">50%</button>' +
        '<button type="button" data-action="cancel-pct" data-pct="25" aria-pressed="' + (pct === 25) + '">25%</button>' +
      '</div><span data-k="amount"></span></div>';
  }

  function rowHtml(row, i) {
    const n = i + 1;
    const timed = core.TIMED_TYPES.includes(row.type);
    const dayCount = core.DAY_COUNT_TYPES.includes(row.type);
    const options = core.TYPES.map(t => '<option value="' + esc(t) + '"' + (t === row.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
    const timeCell = (field, label, ph) => timed
      ? '<input class="time" data-field="' + field + '" value="' + esc(row[field]) + '" placeholder="' + ph + '" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="' + label + ', day ' + n + '">'
      : '<span class="calc na">-</span>';

    return '<tr data-id="' + row.id + '">' +
      '<td class="c-date" data-label="Date"><input type="date" data-field="date" value="' + esc(row.date) + '" aria-label="Date, day ' + n + '"></td>' +
      '<td class="c-desc" data-label="Description"><input type="text" data-field="desc" maxlength="200" value="' + esc(row.desc) + '" placeholder="Description" aria-label="Description, day ' + n + '"></td>' +
      '<td class="c-type" data-label="Type"><select data-field="type" aria-label="Day type, day ' + n + '">' + options + '</select></td>' +
      '<td class="c-call" data-label="Call">' + timeCell('call', 'Call time', '07:00') + '</td>' +
      '<td class="c-wrap" data-label="Wrap">' + timeCell('wrap', 'Wrap time', '17:00') + '</td>' +
      '<td class="c-days" data-label="Days">' + (dayCount
        ? '<input type="number" class="days" data-field="days" min="0" max="365" step="any" inputmode="decimal" value="' + esc(row.days) + '" aria-label="Number of days, day ' + n + '">'
        : '<span class="calc has-value">1</span>') + '</td>' +
      Object.keys(CALC_LABELS).map(k => '<td class="c-calc calc" data-k="' + k + '" data-label="' + CALC_LABELS[k] + '"></td>').join('') +
      '<td class="c-amt calc amt" data-label="Amount">' + (row.type === 'Cancellation Day' ? cancelHtml(row, n) : '<span data-k="amount"></span>') + '</td>' +
      '<td class="c-del"><button type="button" class="icon-btn" data-action="delete" aria-label="Remove day ' + n + '"><svg aria-hidden="true"><use href="#i-x"/></svg></button></td>' +
    '</tr>';
  }

  // focus: { id, selector } to restore focus inside a re-rendered row, or an element to focus
  function renderTable(focus) {
    tbody.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<tr class="ts-empty"><td colspan="17">No days yet. Use Add day below to start the timesheet.</td></tr>';
    refresh();
    if (focus && focus.selector) {
      const el = tbody.querySelector('tr[data-id="' + focus.id + '"] ' + focus.selector);
      if (el) el.focus();
    } else if (focus && focus.focus) {
      focus.focus();
    }
  }

  function setCalc(tr, key, text, hasValue) {
    const td = tr.querySelector('[data-k="' + key + '"]');
    if (!td) return td;
    td.textContent = text;
    td.classList.toggle('has-value', hasValue);
    td.classList.toggle('is-zero', !hasValue);
    return td;
  }

  function refresh() {
    const inv = invoice();
    const trs = tbody.querySelectorAll('tr[data-id]');

    inv.lines.forEach(({ row, c }, i) => {
      const tr = trs[i];
      if (!tr) return;
      const timed = core.TIMED_TYPES.includes(row.type);
      const h = (n, s) => n > 0 ? n.toFixed(2) + (s || '') : '-';
      const m = n => n > 0 ? R(n) : '-';
      setCalc(tr, 'hrs', timed && c.totalHrs > 0 ? c.totalHrs.toFixed(1) + 'h' : '-', timed && c.totalHrs > 0);
      setCalc(tr, 'ot15h', h(c.ot15h), c.ot15h > 0);
      setCalc(tr, 'ot15c', m(c.ot15c), c.ot15c > 0);
      setCalc(tr, 'ot2h', h(c.ot2h), c.ot2h > 0);
      setCalc(tr, 'ot2c', m(c.ot2c), c.ot2c > 0);
      setCalc(tr, 'ot3h', h(c.ot3h), c.ot3h > 0);
      setCalc(tr, 'ot3c', m(c.ot3c), c.ot3c > 0);
      const taH = setCalc(tr, 'tah', h(c.tah, 'h'), c.tah > 0);
      const taC = setCalc(tr, 'tac', m(c.tac), c.tac > 0);
      taH.classList.toggle('is-ta', c.tah > 0);
      taC.classList.toggle('is-ta', c.tac > 0);
      if (row.taWarn) {
        const flag = document.createElement('span');
        flag.className = 'ta-flag';
        flag.textContent = 'T/A';
        taH.appendChild(flag);
      }
      const amt = tr.querySelector('[data-k="amount"]');
      amt.textContent = c.amount > 0 ? R(c.amount) : '-';
      tr.querySelector('.c-amt').classList.toggle('has-value', c.amount > 0);
    });

    const taRow = $('st-ta-row');
    taRow.hidden = !(inv.taTotal > 0);
    $('st-ta-total').textContent = R(inv.taTotal);
    $('st-ta-days').textContent = inv.taCount;

    ['st-taxable', 'st-total', 'gt-taxable', 'bar-taxable'].forEach(id => { $(id).textContent = R(inv.taxable); });
    $('st-paye').textContent = R(inv.paye);
    $('bar-paye').textContent = R(inv.paye);
    $('gt-paye').textContent = '− ' + R(inv.paye);
    $('bar-extras').textContent = R(inv.extrasTotal);
    $('gt-extras').textContent = R(inv.extrasTotal);
    $('extras-sub').textContent = R(inv.extrasTotal);
    $('grand-total').textContent = R(inv.grand);
    $('bar-grand').textContent = R(inv.grand);
    $('hourly-display').textContent = 'R ' + (inv.dailyRate / 10).toLocaleString('en-ZA', { maximumFractionDigits: 2 });

    inv.extras.forEach(e => {
      const cell = $('e-' + e.key + '-amt');
      cell.textContent = R(e.amount);
      cell.classList.toggle('has-value', e.amount > 0);
    });

    scheduleAutosave();
  }

  function rowFromEvent(target) {
    const tr = target.closest('tr[data-id]');
    if (!tr) return null;
    const id = Number(tr.dataset.id);
    const idx = rows.findIndex(r => r.id === id);
    return idx < 0 ? null : { tr, idx, row: rows[idx] };
  }

  tbody.addEventListener('input', e => {
    const field = e.target.dataset.field;
    const hit = rowFromEvent(e.target);
    if (!hit) return;
    // Description has no effect on maths: keep it in state as typed so autosave never misses it
    if (field === 'desc') { hit.row.desc = e.target.value.slice(0, 200); scheduleAutosave(); }
  });

  tbody.addEventListener('change', e => {
    const el = e.target;
    const field = el.dataset.field;
    const hit = rowFromEvent(el);
    if (!field || !hit) return;
    const { row, idx } = hit;
    const n = idx + 1;

    if (field === 'date') {
      row.date = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : '';
      refresh();
    } else if (field === 'desc') {
      row.desc = el.value.slice(0, 200);
      refresh();
    } else if (field === 'type') {
      row.type = core.TYPES.includes(el.value) ? el.value : 'Shoot Day';
      renderTable({ id: row.id, selector: 'select[data-field="type"]' });
    } else if (field === 'days') {
      const v = parseFloat(el.value);
      if (isNaN(v) || v < 0 || v > 365) {
        el.setAttribute('aria-invalid', 'true');
        toast('Day ' + n + ': days must be a number from 0 to 365.', 'error');
        return;
      }
      el.removeAttribute('aria-invalid');
      row.days = v;
      refresh();
    } else if (field === 'call' || field === 'wrap') {
      const label = field === 'call' ? 'call' : 'wrap';
      if (!el.value.trim()) {
        el.removeAttribute('aria-invalid');
        row[field] = '';
        refresh();
        return;
      }
      const parsed = core.parseTimeInput(el.value);
      if (!parsed) {
        el.setAttribute('aria-invalid', 'true');
        el.title = 'Use 24-hour time, e.g. 07:30';
        toast('Day ' + n + ' ' + label + ' time: enter a 24-hour time like 07:30 or 1930.', 'error');
        return;
      }
      el.value = parsed;
      el.removeAttribute('aria-invalid');
      el.removeAttribute('title');
      row[field] = parsed;
      refresh();
    }
  });

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const hit = rowFromEvent(btn);
    if (!hit) return;
    const { row, idx, tr } = hit;

    if (btn.dataset.action === 'delete') {
      rows.splice(idx, 1);
      const neighbour = rows[idx] || rows[idx - 1];
      renderTable(neighbour ? { id: neighbour.id, selector: '[data-action="delete"]' } : $('add-row'));
      toast('Removed day ' + (idx + 1) + '.', 'info');
    } else if (btn.dataset.action === 'cancel-pct') {
      const pct = btn.dataset.pct === '25' ? 25 : 50;
      row.cancelPct = pct;
      tr.querySelectorAll('[data-action="cancel-pct"]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      if (!row.desc || /^Cancellation fee/i.test(row.desc)) {
        row.desc = 'Cancellation fee (' + pct + '% day rate)';
        tr.querySelector('[data-field="desc"]').value = row.desc;
      }
      refresh();
    }
  });

  $('add-row').addEventListener('click', () => {
    if (rows.length >= core.MAX_ROWS) {
      toast('An invoice can hold up to ' + core.MAX_ROWS + ' days. Start a new invoice for the rest.', 'error');
      return;
    }
    const row = newRow();
    rows.push(row);
    renderTable({ id: row.id, selector: 'input[data-field="date"]' });
  });

  // ------------------------------------------------------------ extras

  function renderExtras() {
    $('extras-body').innerHTML = core.EXTRAS.map(e =>
      '<tr>' +
        '<td class="ex-item">' + esc(e.label) + '</td>' +
        '<td class="r" data-label="Days"><input id="e-' + e.key + '-days" type="number" min="0" max="365" step="any" inputmode="decimal" value="0" aria-label="' + esc(e.label) + ', days"></td>' +
        '<td class="r" data-label="Rate (R/day)"><input id="e-' + e.key + '-rate" type="number" min="0" step="any" inputmode="decimal" value="' + e.defaultRate + '" aria-label="' + esc(e.label) + ', rate per day"></td>' +
        '<td class="r ex-amt" data-label="Amount" id="e-' + e.key + '-amt">R 0</td>' +
      '</tr>'
    ).join('');
  }

  // ------------------------------------------------------------ apply / reset

  function applyState(s) {
    Object.keys(FIELD_IDS).forEach(k => { $(FIELD_IDS[k]).value = s.header[k] || ''; });
    if (!$('inv-date').value) $('inv-date').value = core.localDateISO();
    invIssued = s.invIssued;
    $('daily-rate').value = s.dailyRate;
    $('daily-rate').removeAttribute('aria-invalid');
    $('rate-error').textContent = '';
    setBaseHours(s.baseHours, false);
    nextId = 1;
    rows = s.rows.map(r => Object.assign({}, r, { id: nextId++ }));
    core.EXTRAS.forEach(e => {
      $('e-' + e.key + '-days').value = s.extras[e.key].days;
      $('e-' + e.key + '-rate').value = s.extras[e.key].rate;
    });
    if (!$('inv-number').value.trim()) $('inv-number').value = previewNumber();
    updateInvStatus();
    renderTable();
  }

  function setBaseHours(h, doRefresh) {
    baseHours = h === 12 ? 12 : 10;
    $('base-' + baseHours).checked = true;
    $('base-hrs-label').textContent = baseHours === 12
      ? '12-hour deal: overtime starts after hour 12'
      : 'CPA standard: 1 day = 10 base hours';
    if (doRefresh !== false) refresh();
  }

  // ------------------------------------------------------------ dialogs

  function confirmAction(opts) {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = opts.title;
    $('confirm-text').textContent = opts.text;
    const ok = $('confirm-ok');
    ok.textContent = opts.ok || 'Confirm';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    const trigger = document.activeElement;
    return new Promise(resolve => {
      let settled = false;
      // Resolves from the buttons directly. The close event only covers Escape and backdrop clicks,
      // because Chromium delays it until the next rendering update.
      const finish = answer => {
        if (settled) return;
        settled = true;
        ok.removeEventListener('click', onOk);
        $('confirm-cancel').removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
        resolve(answer);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false);
      ok.addEventListener('click', onOk);
      $('confirm-cancel').addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      $('confirm-cancel').focus();
    });
  }

  // Native <dialog> handles the focus trap and Escape. This puts focus back where it came from.
  function openDialog(dlg, initialFocus) {
    const trigger = document.activeElement;
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    if (initialFocus) initialFocus.focus();
  }

  document.querySelectorAll('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) dlg.close();
      // A click on the backdrop lands on the dialog element itself
      else if (e.target === dlg) dlg.close();
    });
  });

  // ------------------------------------------------------------ numbering dialog

  function seqFromForm() {
    return { prefix: $('seq-prefix').value.trim().toUpperCase(), next: Number($('seq-next').value) };
  }

  function updateSeqPreview() {
    const s = seqFromForm();
    const valid = /^[A-Z0-9]{1,10}$/.test(s.prefix) && Number.isInteger(s.next) && s.next >= 1 && s.next <= 999999;
    $('seq-preview').textContent = valid ? core.formatInvoiceNumber(s, $('inv-date').value) : 'Fix the fields above';
  }

  $('seq-btn').addEventListener('click', () => {
    $('seq-prefix').value = seq.prefix;
    $('seq-next').value = seq.next;
    ['seq-prefix', 'seq-next'].forEach(id => { $(id).removeAttribute('aria-invalid'); $(id + '-error').textContent = ''; });
    updateSeqPreview();
    openDialog($('seq-dialog'), $('seq-prefix'));
  });
  $('seq-prefix').addEventListener('input', updateSeqPreview);
  $('seq-next').addEventListener('input', updateSeqPreview);

  $('seq-form').addEventListener('submit', e => {
    e.preventDefault();
    const s = seqFromForm();
    let firstBad = null;
    const check = (id, ok, msg) => {
      $(id).setAttribute('aria-invalid', String(!ok));
      $(id + '-error').textContent = ok ? '' : msg;
      if (!ok && !firstBad) firstBad = $(id);
    };
    check('seq-prefix', /^[A-Z0-9]{1,10}$/.test(s.prefix), 'Use 1 to 10 letters or digits, no spaces or symbols.');
    check('seq-next', Number.isInteger(s.next) && s.next >= 1 && s.next <= 999999, 'Enter a whole number from 1 to 999999.');
    if (firstBad) { firstBad.focus(); return; }

    const current = $('inv-number').value.trim();
    const followsSequence = !invIssued && (!current || core.isAutoNumber(current, seq));
    seq = core.sanitizeSequence(s);
    if (!store.write(KEYS.seq, seq)) toast('This browser blocked storage. The numbering will reset when you reload.', 'error');
    if (followsSequence) $('inv-number').value = previewNumber();
    updateInvStatus();
    scheduleAutosave();
    $('seq-dialog').close();
    toast('Next invoice number is ' + core.formatInvoiceNumber(seq, $('inv-date').value) + '.', 'success');
  });

  // ------------------------------------------------------------ directory

  let dirMode = 'crew';

  function dirGet(type) {
    return core.sanitizeDirectoryEntries(store.read(KEYS[type]), type);
  }
  function dirSet(type, list) {
    if (!store.write(KEYS[type], list)) {
      toast('This browser blocked storage, so the directory was not saved.', 'error');
      return false;
    }
    return true;
  }

  function dirSwitchTab(tab, focusTab) {
    const list = tab === 'list';
    $('tab-list').setAttribute('aria-selected', String(list));
    $('tab-add').setAttribute('aria-selected', String(!list));
    $('tab-list').tabIndex = list ? 0 : -1;
    $('tab-add').tabIndex = list ? -1 : 0;
    $('dir-list-panel').hidden = !list;
    $('dir-add-panel').hidden = list;
    if (list) dirRenderList();
    if (focusTab) (list ? $('tab-list') : $('tab-add')).focus();
  }

  function dirRenderList() {
    const entries = dirGet(dirMode);
    const list = $('dir-list');
    if (!entries.length) {
      list.innerHTML = '<li class="dir-empty">No saved ' + (dirMode === 'crew' ? 'crew members' : 'production companies') +
        ' yet.<br><button type="button" class="btn btn-outline" data-dir-add>Add a profile</button></li>';
      return;
    }
    list.innerHTML = entries.map((e, i) => {
      const name = dirMode === 'crew' ? e.name : e.companyName;
      const sub = dirMode === 'crew'
        ? [e.designation, e.contact, e.rate ? 'R ' + e.rate + '/day' : ''].filter(Boolean).join(' · ')
        : [e.vat ? 'VAT ' + e.vat : '', e.reg ? 'Reg ' + e.reg : ''].filter(Boolean).join(' · ');
      return '<li class="dir-entry">' +
        '<div class="dir-info"><div class="dir-name">' + esc(name) + '</div><div class="dir-sub">' + (sub ? esc(sub) : '&nbsp;') + '</div></div>' +
        '<button type="button" class="btn btn-primary" data-dir-use="' + i + '">Use<span class="visually-hidden"> ' + esc(name) + '</span></button>' +
        '<button type="button" class="icon-btn" data-dir-del="' + i + '" aria-label="Delete ' + esc(name) + '"><svg aria-hidden="true"><use href="#i-x"/></svg></button>' +
      '</li>';
    }).join('');
  }

  function openDirectory(mode) {
    dirMode = mode === 'production' ? 'production' : 'crew';
    $('dir-title').textContent = dirMode === 'production' ? 'Production directory' : 'Crew directory';
    $('dir-crew-fields').hidden = dirMode !== 'crew';
    $('dir-prod-fields').hidden = dirMode !== 'production';
    clearDirForm();
    dirSwitchTab('list');
    openDialog($('dir-dialog'), $('tab-list'));
  }

  function clearDirForm() {
    $('dir-form').reset();
    ['df-name', 'df-rate', 'dp-name'].forEach(id => { $(id).removeAttribute('aria-invalid'); $(id + '-error').textContent = ''; });
  }

  function applyDirEntry(e) {
    if (dirMode === 'crew') {
      const map = { name: 'from-name', designation: 'from-designation', addr: 'from-addr', id: 'from-id', contact: 'from-contact', tax: 'from-tax', bank: 'bank-name', branch: 'bank-branch', acc: 'bank-acc' };
      Object.keys(map).forEach(k => { if (e[k]) $(map[k]).value = e[k]; });
      if (e.rate) { $('daily-rate').value = e.rate; validateRate(); }
    } else {
      const map = { companyName: 'to-name', addr: 'to-addr', reg: 'to-reg', vat: 'to-vat' };
      Object.keys(map).forEach(k => { if (e[k]) $(map[k]).value = e[k]; });
    }
    refresh();
  }

  document.querySelectorAll('[data-open-directory]').forEach(btn => {
    btn.addEventListener('click', () => openDirectory(btn.dataset.openDirectory));
  });

  $('tab-list').addEventListener('click', () => dirSwitchTab('list'));
  $('tab-add').addEventListener('click', () => dirSwitchTab('add'));
  document.querySelector('.tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const onList = $('tab-list').getAttribute('aria-selected') === 'true';
    const target = e.key === 'Home' ? 'list' : e.key === 'End' ? 'add' : (onList ? 'add' : 'list');
    dirSwitchTab(target, true);
  });

  $('dir-list').addEventListener('click', async e => {
    if (e.target.closest('[data-dir-add]')) { dirSwitchTab('add', true); return; }
    const use = e.target.closest('[data-dir-use]');
    const del = e.target.closest('[data-dir-del]');
    const entries = dirGet(dirMode);
    if (use) {
      const entry = entries[Number(use.dataset.dirUse)];
      if (!entry) return;
      applyDirEntry(entry);
      $('dir-dialog').close();
      toast('Loaded ' + (entry.name || entry.companyName) + '.', 'success');
    } else if (del) {
      const i = Number(del.dataset.dirDel);
      const entry = entries[i];
      if (!entry) return;
      const name = entry.name || entry.companyName;
      // The confirm dialog stacks on top of the directory dialog
      const ok = await confirmAction({ title: 'Delete profile', text: 'Delete ' + name + ' from this browser? This cannot be undone.', ok: 'Delete', danger: true });
      if (!ok) return;
      entries.splice(i, 1);
      if (!dirSet(dirMode, entries)) return;
      dirRenderList();
      const next = $('dir-list').querySelector('[data-dir-del="' + Math.min(i, entries.length - 1) + '"]');
      (next || $('tab-list')).focus();
      toast('Deleted ' + name + '.', 'success');
    }
  });

  $('dir-form').addEventListener('submit', e => {
    e.preventDefault();
    let entry;
    let firstBad = null;
    const fail = (id, msg) => {
      $(id).setAttribute('aria-invalid', 'true');
      $(id + '-error').textContent = msg;
      if (!firstBad) firstBad = $(id);
    };
    const ok = id => { $(id).removeAttribute('aria-invalid'); $(id + '-error').textContent = ''; };

    if (dirMode === 'crew') {
      const v = id => $(id).value.trim();
      entry = { name: v('df-name'), designation: v('df-designation'), addr: v('df-addr'), contact: v('df-contact'), tax: v('df-tax'), bank: v('df-bank'), branch: v('df-branch'), acc: v('df-acc'), id: v('df-id'), rate: v('df-rate') };
      if (!entry.name) fail('df-name', 'Enter a name so you can find this profile later.'); else ok('df-name');
      const rate = parseFloat(entry.rate);
      if (entry.rate && (isNaN(rate) || rate < 0)) fail('df-rate', 'Enter a day rate of 0 or more, or leave it blank.'); else ok('df-rate');
    } else {
      const v = id => $(id).value.trim();
      entry = { companyName: v('dp-name'), addr: v('dp-addr'), reg: v('dp-reg'), vat: v('dp-vat') };
      if (!entry.companyName) fail('dp-name', 'Enter a company name so you can find this profile later.'); else ok('dp-name');
    }
    if (firstBad) { firstBad.focus(); return; }

    const clean = core.sanitizeDirectoryEntries([entry], dirMode);
    const merged = core.mergeDirectory(dirGet(dirMode), clean, dirMode);
    if (!dirSet(dirMode, merged)) return;
    clearDirForm();
    dirSwitchTab('list', true);
    toast('Saved ' + (entry.name || entry.companyName) + ' to the directory.', 'success');
  });

  document.querySelectorAll('[data-save-directory]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.saveDirectory;
      const v = id => $(id).value.trim();
      const entry = mode === 'crew'
        ? { name: v('from-name'), designation: v('from-designation'), addr: v('from-addr'), id: v('from-id'), contact: v('from-contact'), tax: v('from-tax'), bank: v('bank-name'), branch: v('bank-branch'), acc: v('bank-acc'), rate: String(getDailyRate()) }
        : { companyName: v('to-name'), addr: v('to-addr'), reg: v('to-reg'), vat: v('to-vat') };
      const label = entry.name || entry.companyName;
      if (!label) {
        const field = mode === 'crew' ? $('from-name') : $('to-name');
        field.focus();
        toast(mode === 'crew' ? 'Fill in your full name first.' : 'Fill in the company name first.', 'error');
        return;
      }
      const merged = core.mergeDirectory(dirGet(mode), core.sanitizeDirectoryEntries([entry], mode), mode);
      if (dirSet(mode, merged)) toast('Saved ' + label + ' to the ' + (mode === 'crew' ? 'crew' : 'production') + ' directory.', 'success');
    });
  });

  $('dir-export').addEventListener('click', () => {
    const data = { kind: 'invoice-generator-directory', version: 1, exportedAt: new Date().toISOString(), crew: dirGet('crew'), production: dirGet('production') };
    if (!data.crew.length && !data.production.length) {
      toast('The directory is empty, so there is nothing to export yet.', 'error');
      return;
    }
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'invoice-directory-' + core.localDateISO() + '.json');
    toast('Exported ' + data.crew.length + ' crew and ' + data.production.length + ' production profiles.', 'success');
  });

  $('dir-import').addEventListener('click', () => $('dir-import-input').click());
  $('dir-import-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = core.sanitizeDirectoryFile(await readJsonFile(file));
      const okCrew = dirSet('crew', core.mergeDirectory(dirGet('crew'), parsed.crew, 'crew'));
      const okProd = okCrew && dirSet('production', core.mergeDirectory(dirGet('production'), parsed.production, 'production'));
      if (!okProd) return;
      dirRenderList();
      toast('Imported ' + parsed.crew.length + ' crew and ' + parsed.production.length + ' production profiles.', 'success');
    } catch (err) {
      toast(err.userMessage || 'That file is not a directory export from this app.', 'error');
    }
  });

  // ------------------------------------------------------------ files

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking straight away cancels the download in some browsers
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function userError(msg) {
    const err = new Error(msg);
    err.userMessage = msg;
    return err;
  }

  function readJsonFile(file) {
    if (file.size > MAX_FILE_BYTES) return Promise.reject(userError('That file is over 1 MB. Session and directory files are much smaller, so it is probably the wrong file.'));
    return file.text().then(text => {
      try { return JSON.parse(text); } catch (e) { throw userError('That file is not valid JSON. Pick a .cpa session or a directory .json export.'); }
    }, () => { throw userError('The browser could not read that file. Try again.'); });
  }

  function baseFilename() {
    const h = readHeader();
    return [
      core.safeFileSegment(numberForExport(), 'Invoice'),
      core.safeFileSegment(h.fromName, 'Crew'),
      core.safeFileSegment(h.jobName, 'Production'),
    ].join('_');
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }

  async function saveSession() {
    const btn = $('save-btn');
    const json = JSON.stringify(gatherState(), null, 2);
    const fname = baseFilename() + '.cpa';
    setBusy(btn, true);
    try {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'Invoice session', accept: { 'application/json': ['.cpa'] } }] });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
          toast('Session saved to ' + handle.name + '.', 'success');
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
          // Any other picker failure falls through to a normal download
        }
      }
      downloadBlob(new Blob([json], { type: 'application/json' }), fname);
      toast('Session saved as ' + fname + '. Load it any time with Load session.', 'success');
    } finally {
      setBusy(btn, false);
    }
  }

  $('save-btn').addEventListener('click', saveSession);
  $('load-btn').addEventListener('click', () => $('load-input').click());
  $('load-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const btn = $('load-btn');
    setBusy(btn, true);
    try {
      const raw = await readJsonFile(file);
      let state;
      try { state = core.sanitizeState(raw); } catch (err) { throw userError('That file is not a session saved by this app.'); }
      applyState(state);
      saveNow();
      const when = raw.savedAt && !isNaN(new Date(raw.savedAt)) ? new Date(raw.savedAt).toLocaleString() : 'an unknown time';
      toast('Session loaded. It was saved ' + when + '.', 'success');
    } catch (err) {
      toast(err.userMessage || 'Could not load that session. Your current invoice is unchanged.', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  // ------------------------------------------------------------ exports

  function validateRate() {
    const el = $('daily-rate');
    const n = parseFloat(el.value);
    const ok = el.value.trim() !== '' && !isNaN(n) && n >= 0 && n <= 1e7;
    el.setAttribute('aria-invalid', String(!ok));
    $('rate-error').textContent = ok ? '' : 'Enter a day rate of 0 or more, e.g. 2500.';
    return ok;
  }

  function validateForExport() {
    if (!validateRate()) {
      $('daily-rate').focus();
      toast('Fix the day rate before exporting.', 'error');
      return false;
    }
    const bad = tbody.querySelector('[aria-invalid="true"]');
    if (bad) {
      bad.focus();
      toast('Fix the highlighted timesheet field before exporting.', 'error');
      return false;
    }
    return true;
  }

  function exportXlsx() {
    const btn = $('xlsx-btn');
    if (!validateForExport()) return;
    if (!window.XLSX || !window.InvoiceXlsx) {
      toast('The spreadsheet library did not load. Check your connection and reload the page.', 'error');
      return;
    }
    setBusy(btn, true);
    // Let the busy state paint before the synchronous build. Not rAF: it never fires in a hidden tab.
    setTimeout(() => {
      try {
        const header = readHeader();
        header.invNumber = numberForExport();
        const { wb, filename } = window.InvoiceXlsx.buildWorkbook(window.XLSX, { header, invoice: invoice() });
        window.XLSX.writeFile(wb, filename);
        commitNumber(header.invNumber);
        toast('Exported ' + filename + '.', 'success');
      } catch (err) {
        toast('Could not build the spreadsheet. Nothing was changed, try again.', 'error');
      } finally {
        setBusy(btn, false);
      }
    }, 30);
  }

  let printCleanup = null;

  function preparePrintSheet(number) {
    const header = readHeader();
    header.invNumber = number;
    $('print-sheet').innerHTML = window.InvoicePrint.buildPrintHtml({ header, invoice: invoice() });
    const prevTitle = document.title;
    // Browsers suggest the document title as the PDF file name
    document.title = baseFilename();
    document.body.classList.add('is-printing');
    printCleanup = () => {
      document.body.classList.remove('is-printing');
      $('print-sheet').innerHTML = '';
      document.title = prevTitle;
      printCleanup = null;
    };
  }

  window.addEventListener('afterprint', () => { if (printCleanup) printCleanup(); });
  // Ctrl+P prints the invoice sheet too, without using up a number
  window.addEventListener('beforeprint', () => {
    if (!printCleanup && window.InvoicePrint) preparePrintSheet($('inv-number').value.trim() || previewNumber());
  });

  function exportPdf() {
    if (!validateForExport()) return;
    const number = numberForExport();
    try {
      preparePrintSheet(number);
    } catch (err) {
      if (printCleanup) printCleanup();
      toast('Could not build the PDF sheet. Nothing was changed, try again.', 'error');
      return;
    }
    commitNumber(number);
    setTimeout(() => window.print(), 50);
  }

  $('xlsx-btn').addEventListener('click', exportXlsx);
  $('pdf-btn').addEventListener('click', exportPdf);

  // ------------------------------------------------------------ new invoice / clear

  $('new-btn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Start a new invoice',
      text: 'This clears the timesheet, job name and extras days, and gives the invoice the next number. Parties, banking, rates and your directory stay. Save the session first if you need this invoice again.',
      ok: 'Start new invoice',
    });
    if (!ok) return;
    nextId = 1;
    rows = [newRow()];
    $('job-name').value = '';
    $('inv-date').value = core.localDateISO();
    core.EXTRAS.forEach(e => { $('e-' + e.key + '-days').value = 0; });
    invIssued = false;
    $('inv-number').value = previewNumber();
    updateInvStatus();
    renderTable();
    saveNow();
    $('job-name').focus();
    toast('Started invoice ' + $('inv-number').value + '.', 'success');
  });

  $('clear-btn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Clear saved data',
      text: 'This deletes the autosaved invoice, the invoice number sequence and both directories from this browser. Session files you saved to disk are not touched. This cannot be undone.',
      ok: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    suppressAutosave = true;
    clearTimeout(autosaveTimer);
    store.keys().filter(k => k.startsWith('ig_') || Object.values(LEGACY_KEYS).includes(k)).forEach(k => store.remove(k));
    location.reload();
  });

  // ------------------------------------------------------------ header inputs

  Object.values(FIELD_IDS).forEach(id => {
    if (id === 'inv-date' || id === 'inv-number') return;
    $(id).addEventListener('input', scheduleAutosave);
  });

  $('inv-date').addEventListener('change', () => {
    const current = $('inv-number').value.trim();
    if (!invIssued && (!current || core.isAutoNumber(current, seq))) $('inv-number').value = previewNumber();
    updateInvStatus();
    scheduleAutosave();
  });
  $('inv-number').addEventListener('input', () => { updateInvStatus(); scheduleAutosave(); });
  $('inv-number').addEventListener('change', () => {
    if (!$('inv-number').value.trim() && !invIssued) $('inv-number').value = previewNumber();
    updateInvStatus();
  });

  $('daily-rate').addEventListener('input', () => {
    if ($('daily-rate').getAttribute('aria-invalid') === 'true') validateRate();
    refresh();
  });
  $('daily-rate').addEventListener('change', validateRate);

  document.querySelectorAll('input[name="base-hours"]').forEach(r => {
    r.addEventListener('change', () => setBaseHours(Number(r.value)));
  });

  $('extras-body').addEventListener('input', refresh);

  window.addEventListener('pagehide', () => { if (autosaveTimer) saveNow(); });

  // ------------------------------------------------------------ back to top

  const toTop = $('to-top');
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      toTop.classList.toggle('show', window.scrollY > 600);
      scrollTicking = false;
    });
  }, { passive: true });

  toTop.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
    // Keyboard and screen reader users land at the top too, not just the viewport
    $('top').focus({ preventScroll: true });
  });

  // ------------------------------------------------------------ init

  function migrateLegacy() {
    if (store.read(KEYS.autosave)) return;
    let migrated = false;
    const legacy = store.read(LEGACY_KEYS.autosave);
    if (legacy) migrated = store.write(KEYS.autosave, legacy) || migrated;
    ['crew', 'production'].forEach(type => {
      const list = store.read(LEGACY_KEYS[type]);
      if (Array.isArray(list) && !store.read(KEYS[type])) {
        migrated = store.write(KEYS[type], core.sanitizeDirectoryEntries(list, type)) || migrated;
      }
    });
    return migrated;
  }

  function init() {
    renderExtras();
    migrateLegacy();

    const saved = store.read(KEYS.autosave);
    if (saved) {
      try {
        applyState(core.sanitizeState(saved));
        setAutosave('saved', 'Restored from this browser');
        toast('Restored your last invoice from this browser.', 'success');
        return;
      } catch (err) {
        toast('The autosaved invoice could not be read, so this is a fresh one.', 'error');
      }
    }

    $('inv-date').value = core.localDateISO();
    $('inv-number').value = previewNumber();
    rows = [
      newRow({ desc: 'Pre-production', type: 'Pre-Production', call: '', wrap: '', days: 2 }),
      newRow({ desc: 'Shoot day 1', call: '06:00', wrap: '18:00' }),
      newRow({ desc: 'Shoot day 2', call: '06:30', wrap: '21:00' }),
    ];
    updateInvStatus();
    renderTable();
    setAutosave('idle', 'Not saved yet');
  }

  init();
})();
