// A small stand-in for K2's runtime behaviour, loaded on top of the saved (script-free)
// DPA pages so the DOM driver can be exercised. It reproduces what was observed on the
// live form: radio selection, the body-level dropdown list, watermark text boxes,
// category-dependent fields, DPA's computed amounts, the file control and adding a row.
// It is a test double. The live page is the real check (milestone 5).
(function () {
  const S = (window.__sim = {
    clicks: [],
    ignoreFileChange: false,
    computeOffset: 0,
    // Live-form variations to test against:
    openOnlyVia: 'any', // 'button': the list opens only from the "..." button
    listNeverOpens: false, // the list never opens; only the hidden <select> works
    itemsDelayMs: 0, // items load this long after the category is chosen
    autoSelect: true, // K2 shows the first item after the category is chosen
    uploaded: null,
    category: null,
  });
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const labels = (root = document) => [...root.querySelectorAll('.SourceCode-Forms-Controls-Web-Label')];
  let panelEl = null;
  // Panel labels first: some texts (e.g. เป็นเงินจำนวน) also appear elsewhere on the form.
  const label = (t) => (panelEl && labels(panelEl).find((l) => norm(l.textContent) === t)) || labels().find((l) => norm(l.textContent) === t);
  const nextCell = (el) => el.closest('span.editor-cell').nextElementSibling;
  const show = (el, on) => {
    if (!el) return;
    el.classList.toggle('hidden', !on);
    el.style.display = on ? '' : 'none';
  };
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const panel = (panelEl = label('หมวดรายการที่เบิก').closest('div.Grid-Layout'));
  // Some names repeat elsewhere on the form (e.g. txt_TotalNight), so prefer the panel's.
  const byName = (n) => panel.querySelector(`input[name="${n}"]`) || document.querySelector(`input[name="${n}"]`);

  // Values K2 binds at runtime (not in a saved page).
  const setRO = (name, v) => { const i = byName(name); if (i) i.value = v; };
  setRO('txt_price_level1', '960.00');
  setRO('txt_price_level2', '4,500.00');
  setRO('Vehicle_price', '4,540.00');
  setRO('Other_price', '0.00');
  setRO('Request_price', '10,000.00');
  const tripInput = nextCell(label('เลขที่ขออนุมัติ')).querySelector('input');
  if (tripInput) tripInput.value = 'TRIP20260000001';

  // ---- clicks on K2 buttons are recorded ----
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('a.SourceCode-Forms-Controls-Web-Button');
    if (b) S.clicks.push(norm(b.textContent));
  }, true);

  // ---- traveller row ----
  const travGrid = [...document.querySelectorAll('div.grid')].find((g) => /สิทธิของเบิก/.test(g.querySelector('.grid-column-header-table')?.textContent || ''));
  travGrid.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || !tr.closest('.grid-content-table')) return;
    tr.classList.add('selected', 'highlighted');
    byName('Name Text Box').value = 'นายทดสอบ บุคคลก';
    byName('Email Text Box').value = 'traveller@example.ac.th';
  });

  // ---- dropdowns: open the body-level list, pick an item ----
  function dropFor(box) { return document.getElementById(box.id + '_droplist'); }
  document.addEventListener('click', (e) => {
    const li = e.target.closest && e.target.closest('div.drop-menu li');
    if (li) {
      const menu = li.closest('div.drop-menu');
      const box = document.getElementById(menu.id.replace(/_droplist$/, ''));
      const span = box.querySelector('a.input-control span');
      span.textContent = li.getAttribute('title');
      span.title = li.getAttribute('title');
      menu.style.display = 'none';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const opener = e.target.closest && e.target.closest(S.openOnlyVia === 'button' ? '.dropdown-box .input-control-buttons a' : '.dropdown-box a');
    if (opener) {
      const box = opener.closest('.dropdown-box');
      if (box.classList.contains('read-only') || S.listNeverOpens) return;
      const menu = dropFor(box);
      if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
  });

  // The hidden <select> behind the item box drives the box when it changes.
  document.addEventListener('change', (e) => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement) || !sel.id.endsWith('_DropDown')) return;
    const box = document.getElementById(sel.id.replace(/_DropDown$/, ''));
    const o = sel.options[sel.selectedIndex];
    if (box && o) box.querySelector('a.input-control span').textContent = o.text;
  });

  // ---- category radios ----
  const ITEMS = {
    'ค่าเบี้ยเลี้ยง': ['ค่าเบี้ยเลี้ยงเดินทางในประเทศ'],
    'ค่าที่พัก': ['ค่าที่พักเดินทางในประเทศ'],
    'ค่ายานพาหนะ': ['ค่าพาหนะเดินทางในประเทศ', 'ค่าบัตรโดยสารเครื่องบินในประเทศ'],
    'ค่าใช้จ่ายอื่นๆ': ['ค่าใช้จ่ายอื่นๆ'],
  };
  const itemBox = nextCell(label('รายการที่เบิก')).querySelector('.dropdown-box');
  const amountInput = byName('Amount Text Box');
  const amountLabel = amountInput.closest('span.editor-cell').previousElementSibling.querySelector('.SourceCode-Forms-Controls-Web-Label');
  const nightsInput = byName('txt_TotalNight');
  const lblNights = label('ที่พักจำนวน');
  const lblDays = label('เบี้ยเลี้ยงจำนวน');
  const daysCell = nextCell(lblDays);
  const daysLabel = daysCell.querySelector('.SourceCode-Forms-Controls-Web-DataLabel');
  const lblDuration = label('รวมเวลาค่าเบี้ยเลี้ยง');
  const durCell = nextCell(lblDuration);
  const evLabel = label('หลักฐานค่าใช้จ่าย');
  const evWrapper = nextCell(evLabel).querySelector('.file-wrapper');
  const totalLabel = nextCell(label('เป็นเงินจำนวน')).querySelector('.SourceCode-Forms-Controls-Web-DataLabel');
  S._els = { nightsInput: () => nightsInput, amountInput: () => amountInput, totalLabel: () => totalLabel };

  function applyCategory(cat) {
    S.category = cat;
    const items = ITEMS[cat];
    const menu = dropFor(itemBox);
    const ul = menu.querySelector('ul.drop-menu');
    const span = itemBox.querySelector('a.input-control span');
    ul.innerHTML = '';
    span.textContent = '';
    const sel = document.getElementById(itemBox.id + '_DropDown');
    const load = () => {
      ul.innerHTML = items.map((t, i) => `<li data-index="${i}" title="${t}"><a href="javascript:;"><span>${t}</span></a></li>`).join('');
      if (sel) sel.innerHTML = items.map((t, i) => `<option value="${i}">${t}</option>`).join('');
      if (S.autoSelect) span.textContent = items[0];
    };
    if (S.itemsDelayMs) setTimeout(load, S.itemsDelayMs); else load();
    const perDiem = cat === 'ค่าเบี้ยเลี้ยง';
    const hotel = cat === 'ค่าที่พัก';
    amountLabel.textContent = perDiem ? 'อัตราต่อวัน' : hotel ? 'อัตราต่อคืน' : 'ระบุจำนวนเงิน';
    amountInput.classList.remove('watermark');
    amountInput.value = perDiem ? '240.00' : hotel ? '1,500.00' : '';
    show(lblNights, hotel);
    show(nightsInput, hotel);
    show([...daysCell.querySelectorAll('.SourceCode-Forms-Controls-Web-Label')].find((l) => norm(l.textContent) === 'คืน'), hotel);
    show(lblDays, perDiem);
    show(daysLabel, perDiem);
    show([...daysCell.querySelectorAll('.SourceCode-Forms-Controls-Web-Label')].find((l) => norm(l.textContent) === 'วัน'), perDiem);
    show(lblDuration, perDiem);
    durCell.querySelectorAll('.SourceCode-Forms-Controls-Web-DataLabel, .SourceCode-Forms-Controls-Web-Label').forEach((e) => show(e, perDiem));
    show(evLabel, !perDiem);
    show(evWrapper, !perDiem);
    recompute();
  }

  panel.addEventListener('click', (e) => {
    const r = e.target.closest('label.input-control.radio');
    if (!r) return;
    r.closest('.multi-select-outer-panel').querySelectorAll('label.input-control.radio').forEach((l) => {
      l.classList.remove('checked');
      l.querySelector('input').checked = false;
    });
    r.classList.add('checked');
    r.querySelector('input').checked = true;
    if (r.closest('.SourceCode-Forms-Controls-Web-Table') === panel || panel.contains(r)) {
      if (ITEMS[r.title]) setTimeout(() => applyCategory(r.title), 120); // K2 reacts asynchronously
    }
  });

  // The saved page may already have a category chosen.
  const initial = panel.querySelector('label.input-control.radio.checked');
  if (initial && ITEMS[initial.title]) {
    S.category = initial.title;
    setTimeout(recompute, 0);
  }

  // ---- watermark text boxes ----
  panel.addEventListener('focusin', (e) => {
    const i = e.target;
    if (i.matches && i.matches('input.watermark')) {
      i.classList.remove('watermark');
      i.value = '';
    }
  });

  // ---- DPA's calculation ----
  const dtInputs = () => ['วันเวลาเดินทางออกจากต้นทาง', 'วันเวลาเริ่มปฏิบัติงาน', 'วันเวลาสิ้นสุดปฏิบัติงาน', 'วันเวลาเดินทางกลับถึงที่ตั้ง'].map((t) => nextCell(label(t)).querySelector('input[type=text]'));
  const parseBe = (s) => {
    const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/.exec(s || '');
    return m ? Date.UTC(+m[3] - 543, +m[2] - 1, +m[1], +m[4], +m[5]) : null;
  };
  const num = (s) => { const n = Number(String(s || '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  function recompute() {
    let total = 0;
    if (S.category === 'ค่าเบี้ยเลี้ยง') {
      const [d0, , , d3] = dtInputs().map((i) => parseBe(i.value));
      if (d0 != null && d3 != null && d3 > d0) {
        const mins = Math.round((d3 - d0) / 60000);
        const d = Math.floor(mins / 1440), rem = mins % 1440;
        const days = d + (rem > 720 ? 1 : 0);
        const dls = durCell.querySelectorAll('.SourceCode-Forms-Controls-Web-DataLabel');
        dls[0].textContent = String(d); dls[1].textContent = String(Math.floor(rem / 60)); dls[2].textContent = String(rem % 60);
        daysLabel.textContent = String(days);
        total = days * num(amountInput.value);
      }
    } else if (S.category === 'ค่าที่พัก') {
      total = num(nightsInput.value) * num(amountInput.value);
    } else {
      total = num(amountInput.value);
    }
    setTimeout(() => { totalLabel.textContent = money(total + S.computeOffset); }, 150);
  }
  panel.addEventListener('change', () => recompute());

  // ---- file control ----
  const fileInput = document.getElementById(evWrapper.querySelector('label.file-label').getAttribute('for'));
  const showFile = (name) => {
    evWrapper.querySelector('.file-watermark').style.display = 'none';
    const info = evWrapper.querySelector('.file-info');
    info.style.display = 'block';
    info.textContent = name;
  };
  fileInput.addEventListener('change', async () => {
    if (S.ignoreFileChange) return;
    const f = fileInput.files[0];
    if (!f) return;
    S.uploaded = { name: f.name, bytes: [...new Uint8Array(await f.arrayBuffer())] };
    setTimeout(() => showFile(f.name), 300); // upload round-trip
  });
  S.manualAttach = (name) => showFile(name);

  // ---- add line ----
  const claimGrid = [...document.querySelectorAll('div.grid')].find((g) => /Signed By/.test(g.querySelector('.grid-column-header-table')?.textContent || '') && /รายการเบิก/.test(g.querySelector('.grid-column-header-table')?.textContent || ''));
  const headers = [...claimGrid.querySelector('.grid-column-header-table tr').children].map((c) => norm(c.textContent));
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('a.SourceCode-Forms-Controls-Web-Button');
    if (!b || norm(b.textContent) !== 'เพิ่มรายการขอเบิก') return;
    setTimeout(() => {
      const tbody = claimGrid.querySelector('.grid-content-table tbody') || claimGrid.querySelector('.grid-content-table');
      const tpl = tbody.querySelector('tr:not(.empty-grid)');
      const tr = tpl.cloneNode(true);
      const set = (h, v) => {
        const i = headers.indexOf(h);
        const td = tr.children[i];
        td.setAttribute('data-options', JSON.stringify({ value: String(v) }));
        td.textContent = String(v);
      };
      const hasFile = evWrapper.querySelector('.file-info').style.display === 'block';
      set('รายการเบิก', itemBox.querySelector('a.input-control span').textContent);
      set('จำนวน', num(totalLabel.textContent));
      set('Signed By', hasFile && S.uploaded ? 'Test Signer' : '');
      set('หลักฐานการเบิก', hasFile ? 'คลิกเพื่อเปิดไฟล์' : '');
      set('ที่พัก (คืน)', S.category === 'ค่าที่พัก' ? nightsInput.value : '');
      set('เบี้ยเลี้ยง (วัน)', S.category === 'ค่าเบี้ยเลี้ยง' ? daysLabel.textContent : '');
      tbody.appendChild(tr);
    }, 400);
  });
})();
