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
// 所得税計算（2026年・甲欄の電算機計算の特例）
// 国税庁 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/all.pdf p.18
// A は非課税交通費を除いた給与から社会保険料等を控除した月額。
// 復興特別所得税を含む。給与所得控除は円未満切上げ、税額は10円単位四捨五入。
// ============================================================

const PAYROLL_VERSION = '2026-10-payslip-auto-v2';
// 添付された2026年8月支払明細を次回以降の概算の基準にする。
// 健康保険・厚生年金は当月給与に比例させず、明細の月額を継続適用。
const PAYSLIP_BASIS = Object.freeze({
  health: 14112, pension: 25620, employmentRate: 0.5, dependents: 0,
  residentTax: 0, otherDeduction: 0
});
function calcIncomeTax(a, dependents = 0) {
  a = Math.max(0, a);
  const salaryDeduction = Math.ceil(a <= 158333 ? 54167 :
    a <= 299999 ? a * 0.3 + 6667 : a <= 549999 ? a * 0.2 + 36667 :
    a <= 708330 ? a * 0.1 + 91667 : 162500);
  const basicDeduction = a <= 2120833 ? 48334 : a <= 2162499 ? 40000 :
    a <= 2204166 ? 26667 : a <= 2245833 ? 13334 : 0;
  const b = Math.max(0, a - salaryDeduction - basicDeduction - 31667 * dependents);
  const tax = b <= 162500 ? b * 0.05105 : b <= 275000 ? b * 0.10210 - 8296 :
    b <= 579166 ? b * 0.20420 - 36374 : b <= 750000 ? b * 0.23483 - 54113 :
    b <= 1500000 ? b * 0.33693 - 130688 : b <= 3333333 ? b * 0.40840 - 237893 :
    b * 0.45945 - 408061;
  return Math.max(0, Math.round(tax / 10) * 10);
}

function parseHours(value) {
  const text = String(value).trim();
  if (!text) return 0;
  // コロン区切りは時:分。小数表記は従来どおり十進時間。
  if (/^\d+:\d{2}$/.test(text)) {
    const [h, m] = text.split(':').map(Number);
    if (m < 60) return h + m / 60;
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  throw new Error('時間は「10:30」（10時間30分）または「10.5」で入力してください。');
}

function computePayroll(p) {
  const base = Math.round(p.hourly * p.regularHours);
  const overtimePay = Math.round(p.hourly * 1.25 * p.overtime);
  const nightPay = Math.round(p.hourly * 1.5 * p.nightOvertime);
  const earningBase = base + overtimePay + nightPay + p.adjustment;
  const gross = earningBase + p.commute;
  // 明細の雇用保険の計算に合わせ、非課税通勤費も含めて円未満切捨て。
  const employment = Math.floor(Math.max(0, gross) * PAYSLIP_BASIS.employmentRate / 100 + 1e-9);
  const { health, pension, dependents, residentTax, otherDeduction } = PAYSLIP_BASIS;
  const socialTotal = health + pension + employment;
  const incomeTax = calcIncomeTax(earningBase - socialTotal, dependents);
  const deductTotal = socialTotal + incomeTax + residentTax + otherDeduction;
  return { base, overtimePay, nightPay, earningBase, gross, health,
    pension, employment, incomeTax, residentTax,
    otherDeduction, adjustment: p.adjustment, commute: p.commute,
    deductTotal, takehome: gross - deductTotal };
}

function calculate(persist = true) {
  try {
    const value = id => document.getElementById(id).value.trim();
    const number = (id, fallback = 0) => {
      const raw = value(id);
      const n = raw === '' ? fallback : Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error('金額・人数・料率には0以上の数値を入力してください。');
      return n;
    };
    const year = number('sel-year');
    const month = number('sel-month');
    const hourly = number('input-hourly');
    const dailyHours = number('input-daily-hours');
    if (!hourly || !dailyHours || dailyHours > 24) throw new Error('時給と1日の所定労働時間（24時間以内）を入力してください。');
    const adjustment = Number(value('input-adjustment') || 0);
    if (!Number.isFinite(adjustment)) throw new Error('課税調整を数値で入力してください。');
    const { working } = getWorkingDaysInfo(year, month);
    const r = computePayroll({ hourly,
      regularHours: value('input-regular-hours') === '' ? dailyHours * working : parseHours(value('input-regular-hours')),
      overtime: parseHours(value('input-overtime')),
      nightOvertime: parseHours(value('input-night-overtime')), adjustment,
      commute: number('input-commute-cost') });
    const fmt = n => n.toLocaleString('ja-JP') + '円';
    const fields = { base: 'base', overtime: 'overtimePay', night: 'nightPay', adjustment: 'adjustment',
      commute: 'commute', gross: 'gross', health: 'health', pension: 'pension', employment: 'employment',
      'income-tax': 'incomeTax',
      'deduction-total': 'deductTotal', takehome: 'takehome' };
    Object.entries(fields).forEach(([id, key]) => {
      const deduct = ['health','pension','employment','incomeTax','residentTax','otherDeduction','deductTotal'].includes(key);
      document.getElementById('r-' + id).textContent = (deduct ? '−' : '') + fmt(r[key]);
    });
    document.getElementById('r-annual-gross').textContent = fmt(r.earningBase * 12);
    document.getElementById('r-annual-takehome').textContent = fmt(r.takehome * 12);
    document.getElementById('result').style.display = 'block';
    document.getElementById('calculation-error').textContent = '';
    currentTakehome = r.takehome;
    updateBalance();
    if (persist) { saveSettings(); saveResult(); }
  } catch (e) {
    document.getElementById('calculation-error').textContent = e.message;
    document.getElementById('result').style.display = 'none';
    currentTakehome = null;
    if (persist) { RESULT = {}; saveAll(); }
    updateBalance();
  }
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

const PAYROLL_INPUTS = ['regular-hours', 'night-overtime', 'adjustment'];

function saveSettings() {
  SETTINGS = {
    hourly:      document.getElementById('input-hourly').value,
    dailyHours:  document.getElementById('input-daily-hours').value,
    overtime:    document.getElementById('input-overtime').value,
    stationFrom: document.getElementById('input-station-from').value,
    stationTo:   document.getElementById('input-station-to').value,
    commute:     document.getElementById('input-commute-cost').value,
  };
  PAYROLL_INPUTS.forEach(key => { SETTINGS[key] = document.getElementById('input-' + key).value; });
  SETTINGS.year = document.getElementById('sel-year').value;
  SETTINGS.month = document.getElementById('sel-month').value;
  saveAll();
}

function saveResult() {
  const ids = ['r-base','r-overtime','r-night','r-adjustment','r-commute','r-gross','r-health','r-pension',
               'r-employment','r-income-tax','r-deduction-total','r-takehome',
               'r-annual-gross','r-annual-takehome'];
  RESULT = { takehome: currentTakehome, shown: true, version: PAYROLL_VERSION };
  ids.forEach(id => { RESULT[id] = document.getElementById(id).textContent; });
  saveAll();
}

function loadResult() {
  const r = RESULT;
  if (!r.shown || r.version !== PAYROLL_VERSION) {
    document.getElementById('result').style.display = 'none';
    currentTakehome = null;
    return;
  }
  const ids = ['r-base','r-overtime','r-night','r-adjustment','r-commute','r-gross','r-health','r-pension',
               'r-employment','r-income-tax','r-deduction-total','r-takehome',
               'r-annual-gross','r-annual-takehome'];
  ids.forEach(id => { document.getElementById(id).textContent = r[id] || '--'; });
  document.getElementById('result').style.display = 'block';
  currentTakehome = r.takehome ?? null;
}

function loadSettings() {
  const s = SETTINGS;
  PAYROLL_INPUTS.forEach(key => {
    if (s[key] !== undefined) document.getElementById('input-' + key).value = s[key];
  });
  if (s.year) document.getElementById('sel-year').value = s.year;
  if (s.month) document.getElementById('sel-month').value = s.month;
  updateWorkingDays();
  if (s.hourly)      document.getElementById('input-hourly').value       = s.hourly;
  if (s.dailyHours)  document.getElementById('input-daily-hours').value  = s.dailyHours;
  if (s.overtime !== undefined)    document.getElementById('input-overtime').value     = s.overtime;
  if (s.stationFrom) document.getElementById('input-station-from').value = s.stationFrom;
  if (s.stationTo)   document.getElementById('input-station-to').value   = s.stationTo;
  if (s.commute !== undefined)     document.getElementById('input-commute-cost').value = s.commute;
}

// ============================================================
// サブスク：ソート
// ============================================================

let sortState = { key: 'added', dir: 'asc' };
let filterCategory = null;
const SORT_LABELS = { added: '追加順', name: '名前順', amount: '金額順' };

const CATEGORIES = [
  { key: 'AI系',        color: '#60a5fa' },
  { key: '恋愛系',     color: '#f472b6' },
  { key: 'エンタメ系', color: '#a78bfa' },
  { key: '音楽系',     color: '#34d399' },
  { key: '仕事系',     color: '#fbbf24' },
  { key: '生活系',     color: '#fb923c' },
  { key: 'その他',     color: '#94a3b8' },
];

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

function setFilter(cat) {
  filterCategory = cat;
  renderAll();
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

  const category = document.getElementById('input-category').value;
  const subs = loadSubs();
  subs.push({ id: Date.now().toString(), name, amount, cycle, category });
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
    const selectOpts = field === 'category'
      ? CATEGORIES.map(c => [c.key, c.key])
      : [['monthly','月額'],['annual','年額']];
    selectOpts.forEach(([v, l]) => {
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

  // ---- サマリーカード ----
  if (subs.length === 0) {
    document.getElementById('summary-total').innerHTML = '<span class="no-data">登録されていません</span>';
  } else {
    const catBreakdown = CATEGORIES
      .map(c => {
        const t = subs.filter(s => s.category === c.key).reduce((sum, s) => sum + toMonthly(s.amount, s.cycle), 0);
        return t > 0 ? { ...c, total: t } : null;
      })
      .filter(Boolean);
    const uncatTotal = subs
      .filter(s => !CATEGORIES.find(c => c.key === s.category))
      .reduce((sum, s) => sum + toMonthly(s.amount, s.cycle), 0);

    let breakdownHtml = '';
    if (catBreakdown.length > 0 || uncatTotal > 0) {
      breakdownHtml = '<div class="cat-breakdown">';
      catBreakdown.forEach(c => {
        breakdownHtml += `<div class="cat-breakdown-row"><span class="cat-badge" style="background:${c.color}20;color:${c.color};border-color:${c.color}40">${escapeHtml(c.key)}</span><span class="cat-breakdown-amt">¥${Math.round(c.total).toLocaleString()}/月</span></div>`;
      });
      if (uncatTotal > 0) {
        breakdownHtml += `<div class="cat-breakdown-row"><span class="cat-badge cat-badge-none">未分類</span><span class="cat-breakdown-amt">¥${Math.round(uncatTotal).toLocaleString()}/月</span></div>`;
      }
      breakdownHtml += '</div>';
    }

    document.getElementById('summary-total').innerHTML =
      `<div class="total-monthly">¥${Math.round(total).toLocaleString()}<span class="total-label">/月</span></div>
       <div class="total-annual">年間 ¥${Math.round(annual).toLocaleString()}</div>${breakdownHtml}`;
  }

  // ---- フィルターバー ----
  const usedCats = new Set(subs.map(s => s.category).filter(c => c && CATEGORIES.find(cat => cat.key === c)));
  const filterBar = document.getElementById('filter-bar');
  let filterHtml = `<button class="btn-filter${!filterCategory ? ' active' : ''}" onclick="setFilter(null)">すべて</button>`;
  CATEGORIES.forEach(c => {
    if (!usedCats.has(c.key)) return;
    const isActive = filterCategory === c.key;
    const activeStyle = isActive ? `background:${c.color}20;color:${c.color};border:1px solid ${c.color}40` : '';
    filterHtml += `<button class="btn-filter${isActive ? ' active' : ''}" style="${activeStyle}" onclick="setFilter('${escapeHtml(c.key)}')">${escapeHtml(c.key)}</button>`;
  });
  filterBar.innerHTML = filterHtml;

  // ---- リスト ----
  updateSortBar();
  const list   = document.getElementById('sub-list');
  const noSubs = document.getElementById('no-subs');
  list.innerHTML = '';

  const displayed = filterCategory ? subs.filter(s => s.category === filterCategory) : subs;

  if (displayed.length === 0) {
    noSubs.textContent = subs.length === 0 ? '登録されていません' : 'このカテゴリには登録がありません';
    noSubs.style.display = 'block';
    updateBalance();
    return;
  }
  noSubs.style.display = 'none';

  getSorted(displayed).forEach(s => {
    const monthly    = toMonthly(s.amount, s.cycle);
    const cycleLabel = s.cycle === 'annual' ? '年額' : '月額';
    const cat = CATEGORIES.find(c => c.key === s.category);
    const catStyle = cat ? `background:${cat.color}20;color:${cat.color};border-color:${cat.color}40` : '';
    const catLabel = cat ? escapeHtml(s.category) : '未分類';
    const catClass = cat ? 'cat-badge editable' : 'cat-badge cat-badge-none editable';

    const li = document.createElement('li');
    li.className = 'sub-item';
    li.innerHTML = `
      <div class="sub-left">
        <span class="${catClass}" style="${catStyle}" onclick="startEdit('${s.id}','category',this,'select')">${catLabel}</span>
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
  // 入力を変更した後に、以前の手取りを現条件の結果として表示しない。
  const invalidateResult = () => {
    currentTakehome = null;
    RESULT = {};
    document.getElementById('result').style.display = 'none';
    document.getElementById('calculation-error').textContent = '';
    updateBalance();
  };
  document.querySelectorAll('.form-grid input, .form-grid select, #input-commute-cost').forEach(el => {
    el.addEventListener('input', invalidateResult);
    el.addEventListener('change', invalidateResult);
  });

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
