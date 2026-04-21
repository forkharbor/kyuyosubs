// ============================================================
// Firebase
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCfvqQWLB8NJqmaH0k2G0wPcbJJjz2Vu4A",
  authDomain: "kaimemo-58bad.firebaseapp.com",
  projectId: "kaimemo-58bad",
  storageBucket: "kaimemo-58bad.firebasestorage.app",
  messagingSenderId: "308069117698",
  appId: "1:308069117698:web:c61a57853abb7e8ffb1c1b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const docRef = db.collection('kyuyo-subs').doc('data');

// ============================================================
// 共有状態
// ============================================================

let currentTakehome = null; // null = 未計算
let SUBS = [];
let SETTINGS = {};
let RESULT = {};

// ============================================================
// 祝日計算
// ============================================================

function getNthWeekday(year, month, weekday, n) {
  const date = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (date.getDay() === weekday) {
      count++;
      if (count === n) return new Date(date);
    }
    date.setDate(date.getDate() + 1);
  }
}

function getShunbunDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function getShubunDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function getJapaneseHolidays(year) {
  const holidays = [];

  function add(name, month, day) {
    holidays.push({ name, date: new Date(year, month - 1, day) });
  }
  function addDate(name, date) {
    holidays.push({ name, date });
  }

  add('元日',           1,  1);
  add('建国記念の日',   2, 11);
  add('天皇誕生日',     2, 23);
  add('昭和の日',       4, 29);
  add('憲法記念日',     5,  3);
  add('みどりの日',     5,  4);
  add('こどもの日',     5,  5);
  add('山の日',         8, 11);
  add('文化の日',      11,  3);
  add('勤労感謝の日',  11, 23);

  add('春分の日', 3, getShunbunDay(year));
  add('秋分の日', 9, getShubunDay(year));

  addDate('成人の日',     getNthWeekday(year, 1,  1, 2));
  addDate('海の日',       getNthWeekday(year, 7,  1, 3));
  addDate('敬老の日',     getNthWeekday(year, 9,  1, 3));
  addDate('スポーツの日', getNthWeekday(year, 10, 1, 2));

  const baseDates = holidays.map(h => h.date.getTime());
  const substitutes = [];

  holidays.forEach(h => {
    if (h.date.getDay() === 0) {
      let sub = new Date(h.date);
      sub.setDate(sub.getDate() + 1);
      const allTimes = [...baseDates, ...substitutes.map(s => s.date.getTime())];
      while (allTimes.includes(sub.getTime())) {
        sub.setDate(sub.getDate() + 1);
      }
      substitutes.push({ name: '振替休日', date: sub });
    }
  });

  return [...holidays, ...substitutes];
}

function getWorkingDaysInfo(year, month) {
  const allHolidays = getJapaneseHolidays(year);
  const holidaySet = new Set(allHolidays.map(h => h.date.toDateString()));
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekdays = 0;
  const holidaysInMonth = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) {
      weekdays++;
      if (holidaySet.has(date.toDateString())) {
        const h = allHolidays.find(h => h.date.toDateString() === date.toDateString());
        if (h) holidaysInMonth.push(h);
      }
    }
  }

  return {
    weekdays,
    holidaysCount: holidaysInMonth.length,
    working: weekdays - holidaysInMonth.length,
    holidayList: holidaysInMonth.sort((a, b) => a.date - b.date)
  };
}

// ============================================================
// 稼働日数表示
// ============================================================

function updateWorkingDays() {
  const year  = parseInt(document.getElementById('sel-year').value);
  const month = parseInt(document.getElementById('sel-month').value);
  const { weekdays, holidaysCount, working, holidayList } = getWorkingDaysInfo(year, month);

  document.getElementById('wd-weekdays').textContent = weekdays;
  document.getElementById('wd-holidays').textContent = holidaysCount;
  document.getElementById('wd-working').textContent  = working;

  const listEl = document.getElementById('holiday-list');
  if (holidayList.length === 0) {
    listEl.innerHTML = '<span class="no-holiday">祝日なし</span>';
  } else {
    listEl.innerHTML = holidayList.map(h => {
      const d = h.date;
      return `<span class="holiday-chip">${d.getMonth() + 1}/${d.getDate()} ${h.name}</span>`;
    }).join('');
  }
}

// ============================================================
// 所得税計算（源泉・概算）
// ============================================================

function calcIncomeTax(annualGrossForTax, annualSocialInsurance) {
  let kyuyoKojo;
  const a = annualGrossForTax;
  if (a <= 1625000)      kyuyoKojo = 550000;
  else if (a <= 1800000) kyuyoKojo = Math.floor(a * 0.4) - 100000;
  else if (a <= 3600000) kyuyoKojo = Math.floor(a * 0.3) + 80000;
  else if (a <= 6600000) kyuyoKojo = Math.floor(a * 0.2) + 440000;
  else if (a <= 8500000) kyuyoKojo = Math.floor(a * 0.1) + 1100000;
  else                   kyuyoKojo = 1950000;

  const kiso    = 480000;
  const taxable = Math.max(0, a - kyuyoKojo - annualSocialInsurance - kiso);

  let annualTax;
  if (taxable <= 1950000)       annualTax = taxable * 0.05;
  else if (taxable <= 3300000)  annualTax = taxable * 0.10 - 97500;
  else if (taxable <= 6950000)  annualTax = taxable * 0.20 - 427500;
  else if (taxable <= 9000000)  annualTax = taxable * 0.23 - 636000;
  else if (taxable <= 18000000) annualTax = taxable * 0.33 - 1536000;
  else if (taxable <= 40000000) annualTax = taxable * 0.40 - 2796000;
  else                          annualTax = taxable * 0.45 - 4796000;

  annualTax = Math.max(0, annualTax) * 1.021;
  return Math.floor(annualTax / 12);
}

// ============================================================
// 給与計算
// ============================================================

function calculate() {
  const year       = parseInt(document.getElementById('sel-year').value);
  const month      = parseInt(document.getElementById('sel-month').value);
  const hourly     = parseFloat(document.getElementById('input-hourly').value) || 0;
  const dailyHours = parseFloat(document.getElementById('input-daily-hours').value) || 8;
  const overtime   = parseFloat(document.getElementById('input-overtime').value) || 0;
  const commute    = parseFloat(document.getElementById('input-commute-cost').value) || 0;

  if (!hourly || hourly <= 0) {
    alert('時給を入力してください');
    return;
  }

  const { working } = getWorkingDaysInfo(year, month);

  const base        = Math.round(hourly * dailyHours * working);
  const overtimePay = Math.round(hourly * 1.25 * overtime);
  const earningBase = base + overtimePay;
  const gross       = earningBase + commute;

  const health      = Math.round(earningBase * 0.0499);
  const pension     = Math.round(Math.min(earningBase, 650000) * 0.0915);
  const employment  = Math.round(earningBase * 0.006);
  const socialTotal = health + pension + employment;

  const incomeTax   = calcIncomeTax(earningBase * 12, socialTotal * 12);
  const deductTotal = socialTotal + incomeTax;
  const takehome    = gross - deductTotal;

  const fmt = n => n.toLocaleString() + '円';

  document.getElementById('r-base').textContent             = fmt(base);
  document.getElementById('r-overtime').textContent         = fmt(overtimePay);
  document.getElementById('r-commute').textContent          = fmt(commute);
  document.getElementById('r-gross').textContent            = fmt(gross);
  document.getElementById('r-health').textContent           = '−' + fmt(health);
  document.getElementById('r-pension').textContent          = '−' + fmt(pension);
  document.getElementById('r-employment').textContent       = '−' + fmt(employment);
  document.getElementById('r-income-tax').textContent       = '−' + fmt(incomeTax);
  document.getElementById('r-deduction-total').textContent  = '−' + fmt(deductTotal);
  document.getElementById('r-takehome').textContent         = fmt(takehome);
  document.getElementById('r-annual-gross').textContent     = fmt(gross * 12);
  document.getElementById('r-annual-takehome').textContent  = fmt(takehome * 12);

  document.getElementById('result').style.display = 'block';

  currentTakehome = takehome;
  updateBalance();
  saveSettings();
  saveResult();
}

// ============================================================
// 差引残額の更新
// ============================================================

function updateBalance() {
  const subs         = loadSubs();
  const subMonthly   = Math.round(subs.reduce((sum, s) => sum + toMonthly(s.amount, s.cycle), 0));
  const bTakehome    = document.getElementById('b-takehome');
  const bSubs        = document.getElementById('b-subs');
  const bBalance     = document.getElementById('b-balance');
  const bNote        = document.getElementById('b-note');
  const balanceCard  = document.querySelector('.balance-card');
  const balanceResult = document.querySelector('.balance-result');

  const fmt = n => '¥' + n.toLocaleString();

  bSubs.textContent = subMonthly > 0 ? fmt(subMonthly) : '¥0';

  if (currentTakehome === null) {
    bTakehome.textContent = '--';
    bBalance.textContent  = '--';
    bNote.style.display   = 'block';
    balanceCard.classList.remove('has-result', 'is-negative');
    balanceResult.classList.remove('negative');
    return;
  }

  const balance = currentTakehome - subMonthly;

  bTakehome.textContent = fmt(currentTakehome);
  bBalance.textContent  = fmt(balance);
  bNote.style.display   = 'none';
  balanceCard.classList.add('has-result');

  if (balance < 0) {
    balanceCard.classList.add('is-negative');
    balanceResult.classList.add('negative');
  } else {
    balanceCard.classList.remove('is-negative');
    balanceResult.classList.remove('negative');
  }
}

// ============================================================
// 路線検索
// ============================================================

function searchRoute() {
  const from = document.getElementById('input-station-from').value.trim();
  const to   = document.getElementById('input-station-to').value.trim();
  if (!from || !to) {
    alert('出発駅と会社の最寄り駅を入力してください');
    return;
  }
  window.open(
    `https://transit.yahoo.co.jp/search/print?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=4`,
    '_blank'
  );
}

// ============================================================
// 設定の保存・読み込み（給与）
// ============================================================

function saveSettings() {
  SETTINGS = {
    hourly:      document.getElementById('input-hourly').value,
    dailyHours:  document.getElementById('input-daily-hours').value,
    overtime:    document.getElementById('input-overtime').value,
    stationFrom: document.getElementById('input-station-from').value,
    stationTo:   document.getElementById('input-station-to').value,
    commute:     document.getElementById('input-commute-cost').value,
  };
  saveAll();
}

function saveResult() {
  const ids = ['r-base','r-overtime','r-commute','r-gross','r-health','r-pension',
               'r-employment','r-income-tax','r-deduction-total','r-takehome',
               'r-annual-gross','r-annual-takehome'];
  RESULT = { takehome: currentTakehome, shown: true };
  ids.forEach(id => { RESULT[id] = document.getElementById(id).textContent; });
  saveAll();
}

function loadResult() {
  const r = RESULT;
  if (!r.shown) return;
  const ids = ['r-base','r-overtime','r-commute','r-gross','r-health','r-pension',
               'r-employment','r-income-tax','r-deduction-total','r-takehome',
               'r-annual-gross','r-annual-takehome'];
  ids.forEach(id => { document.getElementById(id).textContent = r[id] || '--'; });
  document.getElementById('result').style.display = 'block';
  currentTakehome = r.takehome ?? null;
}

function loadSettings() {
  const s = SETTINGS;
  if (s.hourly)      document.getElementById('input-hourly').value       = s.hourly;
  if (s.dailyHours)  document.getElementById('input-daily-hours').value  = s.dailyHours;
  if (s.overtime)    document.getElementById('input-overtime').value     = s.overtime;
  if (s.stationFrom) document.getElementById('input-station-from').value = s.stationFrom;
  if (s.stationTo)   document.getElementById('input-station-to').value   = s.stationTo;
  if (s.commute)     document.getElementById('input-commute-cost').value = s.commute;
}

// ============================================================
// サブスク：ソート
// ============================================================

let sortState = { key: 'added', dir: 'asc' };
const SORT_LABELS = { added: '追加順', name: '名前順', amount: '金額順' };

function setSort(key) {
  if (sortState.key === key) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.key = key;
    sortState.dir = key === 'amount' ? 'desc' : 'asc';
  }
  renderAll();
}

function getSorted(subs) {
  const { key, dir } = sortState;
  return [...subs].sort((a, b) => {
    if (key === 'name') {
      return dir === 'asc'
        ? a.name.localeCompare(b.name, 'ja')
        : b.name.localeCompare(a.name, 'ja');
    }
    if (key === 'amount') {
      const va = toMonthly(a.amount, a.cycle);
      const vb = toMonthly(b.amount, b.cycle);
      return dir === 'asc' ? va - vb : vb - va;
    }
    return dir === 'asc' ? Number(a.id) - Number(b.id) : Number(b.id) - Number(a.id);
  });
}

function updateSortBar() {
  ['added', 'name', 'amount'].forEach(key => {
    const btn = document.getElementById('sort-btn-' + key);
    const isActive = sortState.key === key;
    btn.className = 'btn-sort' + (isActive ? ' active' : '');
    const arrow = isActive ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : '';
    btn.textContent = SORT_LABELS[key] + arrow;
  });
}

// ============================================================
// サブスク：データ操作
// ============================================================

function loadSubs() {
  return SUBS;
}

function saveSubs(subs) {
  SUBS = subs;
  saveAll();
}

function saveAll() {
  docRef.set({ subs: SUBS, settings: SETTINGS, result: RESULT });
}

function toMonthly(amount, cycle) {
  return cycle === 'annual' ? amount / 12 : amount;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addSub() {
  const name   = document.getElementById('input-name').value.trim();
  const amount = parseFloat(document.getElementById('input-amount').value);
  const cycle  = document.getElementById('input-cycle').value;
  if (!name)                { alert('サービス名を入力してください'); return; }
  if (!amount || amount < 0){ alert('金額を入力してください');       return; }

  const subs = loadSubs();
  subs.push({ id: Date.now().toString(), name, amount, cycle });
  saveSubs(subs);

  document.getElementById('input-name').value   = '';
  document.getElementById('input-amount').value = '';

  renderAll();
}

function deleteSub(id) {
  if (!confirm('削除しますか？')) return;
  saveSubs(loadSubs().filter(s => s.id !== id));
  renderAll();
}

function startEdit(id, field, el, type = 'text') {
  const subs = loadSubs();
  const sub  = subs.find(s => s.id === id);
  if (!sub) return;

  if (type === 'select') {
    const sel = document.createElement('select');
    sel.className = 'cell-input';
    [['monthly','月額'],['annual','年額']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      if (v === sub[field]) o.selected = true;
      sel.appendChild(o);
    });
    el.replaceWith(sel); sel.focus();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const s2 = loadSubs(); const s = s2.find(s => s.id === id);
      if (s) { s[field] = sel.value; saveSubs(s2); }
      renderAll();
    };
    sel.addEventListener('change', commit);
    sel.addEventListener('blur', commit);
    return;
  }

  const input = document.createElement('input');
  input.type = type; input.value = sub[field]; input.className = 'cell-input';
  if (type === 'number') { input.step = 'any'; input.min = '0'; }
  el.replaceWith(input); input.focus(); input.select();

  let done = false;
  function commit() {
    if (done) return; done = true;
    const val = type === 'number' ? parseFloat(input.value) : input.value.trim();
    if (!val || (type === 'number' && val < 0)) { renderAll(); return; }
    const s2 = loadSubs(); const s = s2.find(s => s.id === id);
    if (s) { s[field] = val; saveSubs(s2); }
    renderAll();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commit();
    if (e.key === 'Escape') { done = true; renderAll(); }
  });
  input.addEventListener('blur', commit);
}

// ============================================================
// サブスク：描画
// ============================================================

function renderAll() {
  const subs   = loadSubs();
  const total  = subs.reduce((sum, s) => sum + toMonthly(s.amount, s.cycle), 0);
  const annual = total * 12;

  document.getElementById('summary-total').innerHTML = subs.length === 0
    ? '<span class="no-data">登録されていません</span>'
    : `<div class="total-monthly">¥${Math.round(total).toLocaleString()}<span class="total-label">/月</span></div>
       <div class="total-annual">年間 ¥${Math.round(annual).toLocaleString()}</div>`;

  updateSortBar();
  const list   = document.getElementById('sub-list');
  const noSubs = document.getElementById('no-subs');
  list.innerHTML = '';

  if (subs.length === 0) { noSubs.style.display = 'block'; return; }
  noSubs.style.display = 'none';

  getSorted(subs).forEach(s => {
    const monthly    = toMonthly(s.amount, s.cycle);
    const cycleLabel = s.cycle === 'annual' ? '年額' : '月額';

    const li = document.createElement('li');
    li.className = 'sub-item';
    li.innerHTML = `
      <div class="sub-left">
        <span class="sub-name editable" onclick="startEdit('${s.id}','name',this)">${escapeHtml(s.name)}</span>
      </div>
      <div class="sub-right">
        <span class="sub-amount editable" onclick="startEdit('${s.id}','amount',this,'number')">¥${s.amount.toLocaleString()}</span>
        <span class="sub-cycle editable" onclick="startEdit('${s.id}','cycle',this,'select')">${cycleLabel}</span>
        ${s.cycle === 'annual' ? `<span class="sub-monthly">月換算 ¥${Math.round(monthly).toLocaleString()}</span>` : ''}
        <button class="btn-delete" onclick="deleteSub('${s.id}')">削除</button>
      </div>
    `;
    list.appendChild(li);
  });

  // サブスクが変わったら差引残額も更新
  updateBalance();
}

// ============================================================
// 初期化
// ============================================================

function init() {
  const yearSel  = document.getElementById('sel-year');
  const monthSel = document.getElementById('sel-month');
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  for (let y = currentYear - 1; y <= currentYear + 3; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    yearSel.appendChild(opt);
  }

  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === currentMonth) opt.selected = true;
    monthSel.appendChild(opt);
  }

  yearSel.addEventListener('change', updateWorkingDays);
  monthSel.addEventListener('change', updateWorkingDays);

  updateWorkingDays();
  renderAll();
}

init();

// ============================================================
// Firestore 同期
// ============================================================

const MIGRATED_KEY = 'kyuyo_subs_migrated';
if (!localStorage.getItem(MIGRATED_KEY)) {
  const savedSubs     = localStorage.getItem('subs');
  const savedSettings = localStorage.getItem('kyuyo_settings');
  const savedResult   = localStorage.getItem('kyuyo_result');
  if (savedSubs || savedSettings || savedResult) {
    docRef.set({
      subs:     savedSubs     ? JSON.parse(savedSubs)     : [],
      settings: savedSettings ? JSON.parse(savedSettings) : {},
      result:   savedResult   ? JSON.parse(savedResult)   : {}
    });
  }
  localStorage.setItem(MIGRATED_KEY, '1');
}

docRef.onSnapshot(snap => {
  if (snap.exists) {
    const d = snap.data();
    SUBS     = d.subs     || [];
    SETTINGS = d.settings || {};
    RESULT   = d.result   || {};
  }
  loadSettings();
  loadResult();
  renderAll();
});
