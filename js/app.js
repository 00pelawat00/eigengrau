import * as V from './vault.js';
import * as DB from './db.js';
import { seedState } from './seed.js';
import { normRecovery } from './crypto.js';
import { parseImport, planImport, applyImport } from './importer.js';

// ---------- helpers ---------------------------------------------------------
const root = document.getElementById('root');
const modalEl = document.getElementById('modal');
const prefs = (() => { try { return JSON.parse(localStorage.getItem('eg-prefs')) || {}; } catch { return {}; } })();
function savePrefs() { try { localStorage.setItem('eg-prefs', JSON.stringify(prefs)); } catch {} }
let lang = prefs.lang || 'bm';
const L = (bm, en) => (lang === 'bm' ? bm : en);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (id, cls = '') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const S = () => V.state;

function applyPrefs() {
  document.documentElement.dataset.size = prefs.size || 'm';
  document.documentElement.lang = lang === 'bm' ? 'ms' : 'en';
}
function setLang(l) { lang = l; prefs.lang = l; savePrefs(); applyPrefs(); if (V.isUnlocked()) V.setMeta({ lang: l }); rerender(); }
function setSize(sz) { prefs.size = sz; savePrefs(); applyPrefs(); if (V.isUnlocked()) V.setMeta({ textSize: sz }); rerender(); }

let toastT;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.appendChild(d);
  clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 3200);
}

// ---------- dates -----------------------------------------------------------
const MON = { bm: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
const DAY = { bm: ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const DAYF = { bm: ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysUntil = s => Math.round((parse(s) - today()) / 864e5);
const fmt = (s, withDay) => { if (!s) return ''; const d = parse(s); return `${withDay ? DAY[lang][d.getDay()] + ', ' : ''}${d.getDate()} ${MON[lang][d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = s => { const d = parse(s); return `${d.getDate()} ${MON[lang][d.getMonth()]}`; };
function monthIndex(d) {
  const [y0, m0] = S().meta.startMonth.split('-').map(Number);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getFullYear() - y0) * 12 + (d.getMonth() + 1 - m0) + 1 + (d.getDate() - 1) / dim;
}
function monthLabel(n) { const [y0, m0] = S().meta.startMonth.split('-').map(Number); const d = new Date(y0, m0 - 1 + n - 1, 1); return `${MON[lang][d.getMonth()]} ${d.getFullYear()}`; }
function weekRange() { const t = today(); const dow = (t.getDay() + 6) % 7; const a = new Date(t); a.setDate(t.getDate() - dow); const b = new Date(a); b.setDate(a.getDate() + 6); return [iso(a), iso(b)]; }
function dueBadge(due, done) {
  if (!due || done) return due ? `<span class="small">${fmtShort(due)}</span>` : '';
  const n = daysUntil(due);
  if (n < 0) return `<span class="pill p-rose">${L(`Lewat ${-n} hari`, `${-n} day${n === -1 ? '' : 's'} late`)}</span>`;
  if (n === 0) return `<span class="pill p-amber">${L('Hari ini', 'Today')}</span>`;
  if (n === 1) return `<span class="pill p-amber">${L('Esok', 'Tomorrow')}</span>`;
  if (n <= 6) return `<span class="small">${DAY[lang][parse(due).getDay()]}</span>`;
  return `<span class="small">${fmtShort(due)}</span>`;
}
const COLORS = ['lav', 'sage', 'amber', 'rose', 'slate', 'grey'];
const cvar = c => `var(--${COLORS.includes(c) ? c : 'lav'})`;
const ctext = c => (c === 'grey' ? 'var(--muted)' : cvar(c));

// ---------- boot / lock -----------------------------------------------------
let route = location.hash.slice(1) || 'dashboard';
let view = 'lock'; // lock | setup | app
const ui = { taskFilter: 'all', taskMode: matchMedia('(max-width:760px)').matches ? 'list' : 'board', tlMode: null, meetingSel: null, litFilter: 'all', litQ: '', litTag: '' };

async function boot() {
  applyPrefs();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (await V.hasVault()) showLock(); else showSetup();
}

function rerender() {
  if (view === 'app') renderApp();
  else if (view === 'lock') showLock(lockMode);
  else if (view === 'setup') renderSetup();
}

const langToggle = () => `<div class="seg" role="group" aria-label="Language"><button data-act="lang" data-v="bm" class="${lang === 'bm' ? 'on' : ''}">BM</button><button data-act="lang" data-v="en" class="${lang === 'en' ? 'on' : ''}">EN</button></div>`;
const appIcon = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 120 120"><use href="#appicon"/></svg>`;
const e2eLine = () => `<div class="e2e">${ic('i-lock')}<span>${L('AES-256 · data disulitkan dalam peranti anda', 'AES-256 · data encrypted on your device')}</span></div>`;

let lockMode = null;
async function showLock(mode) {
  view = 'lock'; closeModal();
  const pin = await V.pinInfo();
  lockMode = mode || (pin ? 'pin' : 'pw');
  const head = `<div style="display:flex;justify-content:flex-end;margin-bottom:1rem">${langToggle()}</div>${appIcon(84)}<h1 class="serif" style="font-size:1.75rem;margin-top:.8rem">Eigengrau</h1>`;
  if (lockMode === 'pin') {
    root.innerHTML = `<div class="center"><div class="lockbox">${head}
      <div class="small">${L('Masukkan PIN', 'Enter PIN')}</div>
      <div class="pin" id="pindots">${'<i></i>'.repeat(6)}</div>
      <div class="err" id="err"></div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="pinkey" data-v="${n}">${n}</button>`).join('')}<span></span><button data-act="pinkey" data-v="0">0</button><button class="ghost" data-act="pinkey" data-v="del" aria-label="Delete">⌫</button></div>
      <p style="margin-top:1.4rem"><button class="linkbtn" data-act="lockmode" data-v="pw">${L('Guna kata laluan', 'Use password')}</button></p>
      ${e2eLine()}</div></div>`;
    pinBuf = '';
  } else if (lockMode === 'pw') {
    root.innerHTML = `<div class="center"><div class="lockbox">${head}
      <div class="small">${L('Data anda dikunci. Masukkan kata laluan untuk buka.', 'Your data is locked. Enter your password to unlock.')}</div>
      <form id="pwform" style="margin-top:1.2rem">
        <input type="password" name="pw" autocomplete="current-password" placeholder="${L('Kata laluan', 'Password')}" required autofocus>
        <div class="err" id="err"></div>
        <button class="btn block" style="margin-top:.6rem">${L('Buka kunci', 'Unlock')}</button>
      </form>
      <p style="margin-top:1rem;display:flex;justify-content:space-between">
        ${pin ? `<button class="linkbtn" data-act="lockmode" data-v="pin">${L('Guna PIN', 'Use PIN')}</button>` : '<span></span>'}
        <button class="linkbtn" data-act="lockmode" data-v="rec">${L('Lupa kata laluan?', 'Forgot password?')}</button></p>
      ${e2eLine()}</div></div>`;
    root.querySelector('#pwform').onsubmit = async e => {
      e.preventDefault(); const pw = e.target.pw.value; const btn = e.target.querySelector('button'); btn.disabled = true;
      btn.textContent = L('Membuka…', 'Unlocking…');
      try { await V.unlockPassword(pw); afterUnlock(); }
      catch { root.querySelector('#err').textContent = L('Kata laluan salah.', 'Wrong password.'); btn.disabled = false; btn.textContent = L('Buka kunci', 'Unlock'); }
    };
    setTimeout(() => root.querySelector('input')?.focus(), 50);
  } else {
    root.innerHTML = `<div class="center"><div class="lockbox">${head}
      <div class="small">${L('Masukkan kunci pemulihan yang anda simpan semasa mula guna, dan pilih kata laluan baru.', 'Enter the recovery key you saved at setup, and choose a new password.')}</div>
      <form id="recform" style="margin-top:1.2rem">
        <label class="f"><span>${L('Kunci pemulihan', 'Recovery key')}</span><input name="rec" placeholder="XXXX-XXXX-…" required autocomplete="off"></label>
        <label class="f"><span>${L('Kata laluan baru (min. 8 aksara)', 'New password (min. 8 characters)')}</span><input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
        <div class="err" id="err"></div>
        <button class="btn block">${L('Tetapkan semula & buka', 'Reset & unlock')}</button>
      </form>
      <p style="margin-top:1rem"><button class="linkbtn" data-act="lockmode" data-v="pw">← ${L('Kembali', 'Back')}</button></p></div></div>`;
    root.querySelector('#recform').onsubmit = async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      try { await V.unlockRecovery(normRecovery(e.target.rec.value), e.target.pw.value); toast(L('Kata laluan baru ditetapkan.', 'New password set.')); afterUnlock(); }
      catch { root.querySelector('#err').textContent = L('Kunci pemulihan tidak sah.', 'Invalid recovery key.'); btn.disabled = false; }
    };
  }
}

let pinBuf = '', pinBusy = false;
async function pinKey(v) {
  if (pinBusy) return;
  if (v === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 6) pinBuf += v;
  root.querySelectorAll('#pindots i').forEach((d, i) => d.classList.toggle('f', i < pinBuf.length));
  if (pinBuf.length === 6) {
    pinBusy = true;
    try { await V.unlockPin(pinBuf); pinBusy = false; afterUnlock(); }
    catch (e) {
      pinBusy = false; pinBuf = '';
      root.querySelectorAll('#pindots i').forEach(d => d.classList.remove('f'));
      if (e.left === 0) { await showLock('pw'); root.querySelector('#err').textContent = L('Terlalu banyak cubaan. PIN dibuang, sila guna kata laluan.', 'Too many tries. PIN removed, please use your password.'); }
      else root.querySelector('#err').textContent = L(`PIN salah. ${e.left} cubaan lagi.`, `Wrong PIN. ${e.left} tries left.`);
    }
  }
}

function afterUnlock() {
  const m = S().meta;
  if (m.lang && m.lang !== lang) { lang = m.lang; prefs.lang = lang; }
  if (m.textSize) prefs.size = m.textSize;
  savePrefs(); applyPrefs();
  lastAct = Date.now();
  view = 'app'; renderApp();
}

function doLock() { V.saveNow().finally(() => { V.lock(); showLock(); }); }

// auto-lock on inactivity
let lastAct = Date.now(), hiddenAt = 0;
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
setInterval(() => { if (V.isUnlocked() && Date.now() - lastAct > S().meta.autoLockMin * 60000) doLock(); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); V.saveNow(); }
  else if (V.isUnlocked() && hiddenAt && Date.now() - hiddenAt > S().meta.autoLockMin * 60000) doLock();
});
addEventListener('pagehide', () => V.saveNow());

// ---------- setup -----------------------------------------------------------
const setup = { step: 'welcome', name: '', pw: '', recovery: '' };
function showSetup() { view = 'setup'; setup.step = 'welcome'; renderSetup(); }
function renderSetup() {
  const wrap = inner => `<div class="center"><div class="lockbox" style="max-width:28rem"><div style="display:flex;justify-content:flex-end;margin-bottom:1rem">${langToggle()}</div>${inner}</div></div>`;
  const st = setup.step;
  if (st === 'welcome') {
    root.innerHTML = wrap(`${appIcon(96)}<h1 class="serif" style="font-size:2rem;margin:.8rem 0 .3rem">Eigengrau</h1>
      <p class="muted" style="margin-bottom:1.4rem">${L('Pengurus PhD peribadi anda. Semua data disulitkan dan disimpan dalam peranti ini sahaja.', 'Your personal PhD manager. All data is encrypted and kept on this device only.')}</p>
      <form id="f1"><label class="f"><span>${L('Nama panggilan', 'What should I call you?')}</span><input name="name" value="${esc(setup.name)}" placeholder="Lynn" required></label>
      <button class="btn block">${L('Mula baru', 'Start fresh')}</button></form>
      <p style="margin-top:1rem"><button class="linkbtn" data-act="setupstep" data-v="restore">${L('Ada fail backup/sync dari peranti lain? Pulihkan', 'Have a backup/sync file from another device? Restore')}</button></p>`);
    root.querySelector('#f1').onsubmit = e => { e.preventDefault(); setup.name = e.target.name.value.trim(); setup.step = 'password'; renderSetup(); };
  } else if (st === 'password') {
    root.innerHTML = wrap(`<div class="steps">${L('Langkah 1 / 3', 'Step 1 / 3')}</div><h2>${L('Cipta kata laluan', 'Create a password')}</h2>
      <p class="small" style="margin:.4rem 0 1rem">${L('Kata laluan ini menyulitkan semua data anda. Ia tidak dihantar ke mana-mana dan tiada siapa boleh bukanya untuk anda, jadi pilih yang anda ingat.', 'This password encrypts all your data. It is never sent anywhere and nobody can recover it for you, so pick one you will remember.')}</p>
      <form id="f2" style="text-align:left">
        <label class="f"><span>${L('Kata laluan (min. 8 aksara)', 'Password (min. 8 characters)')}</span><input type="password" name="a" minlength="8" required autocomplete="new-password"></label>
        <label class="f"><span>${L('Ulang kata laluan', 'Repeat password')}</span><input type="password" name="b" minlength="8" required autocomplete="new-password"></label>
        <div class="err" id="err"></div><button class="btn block">${L('Teruskan', 'Continue')}</button></form>`);
    root.querySelector('#f2').onsubmit = e => {
      e.preventDefault();
      if (e.target.a.value !== e.target.b.value) { root.querySelector('#err').textContent = L('Kata laluan tidak sama.', 'Passwords do not match.'); return; }
      setup.pw = e.target.a.value; setup.step = 'plan'; renderSetup();
    };
  } else if (st === 'plan') {
    root.innerHTML = wrap(`<div class="steps">${L('Langkah 2 / 3', 'Step 2 / 3')}</div><h2>${L('Mula dengan apa?', 'How do you want to start?')}</h2>
      <div style="display:flex;flex-direction:column;gap:.8rem;margin-top:1.2rem;text-align:left">
        <button class="card" data-act="create" data-v="seed" style="cursor:pointer;text-align:left"><b>${L('Guna pelan PhD saya (DEFEND-PQC)', 'Use my PhD plan (DEFEND-PQC)')}</b><div class="small" style="margin-top:.3rem">${L('Fasa, milestone (M1 = Sep 2026) dan tugasan semasa diisi siap. Boleh ubah bila-bila.', 'Phases, milestones (M1 = Sep 2026) and current tasks pre-filled. Editable any time.')}</div></button>
        <button class="card" data-act="create" data-v="empty" style="cursor:pointer;text-align:left"><b>${L('Mula kosong', 'Start empty')}</b><div class="small" style="margin-top:.3rem">${L('Isi semua sendiri.', 'Fill everything in yourself.')}</div></button>
      </div><div class="err" id="err"></div>`);
  } else if (st === 'recovery') {
    root.innerHTML = wrap(`<div class="steps">${L('Langkah 3 / 3', 'Step 3 / 3')}</div><h2>${L('Simpan kunci pemulihan', 'Save your recovery key')}</h2>
      <p class="small" style="margin:.4rem 0">${L('Kalau terlupa kata laluan, ini satu-satunya cara untuk buka data anda. Salin dan simpan di tempat selamat (contoh: password manager atau kertas).', 'If you forget your password, this is the only way back into your data. Copy it somewhere safe (e.g. a password manager or on paper).')}</p>
      <div class="reckey" id="rk">${esc(setup.recovery)}</div>
      <button class="btn ghost" data-act="copyrec">${L('Salin', 'Copy')}</button>
      <label style="display:flex;gap:.6rem;align-items:center;justify-content:center;margin:1.2rem 0"><input type="checkbox" id="saved" style="width:auto"> ${L('Saya dah simpan kunci ini', 'I have saved this key')}</label>
      <button class="btn block" id="go" disabled data-act="setupstep" data-v="pin">${L('Teruskan', 'Continue')}</button>`);
    root.querySelector('#saved').onchange = e => { root.querySelector('#go').disabled = !e.target.checked; };
  } else if (st === 'pin') {
    root.innerHTML = wrap(`<h2>${L('Tetapkan PIN untuk buka cepat?', 'Set a PIN for quick unlock?')}</h2>
      <p class="small" style="margin:.4rem 0 1rem">${L('PIN 6 digit untuk buka di peranti ini. Selepas 5 cubaan salah, atau setiap 14 hari, kata laluan diperlukan semula.', 'A 6-digit PIN to unlock on this device. After 5 wrong tries, or every 14 days, your password is required again.')}</p>
      <form id="fp" style="text-align:left"><div class="row2">
        <label class="f"><span>PIN</span><input name="a" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" type="password" required></label>
        <label class="f"><span>${L('Ulang PIN', 'Repeat PIN')}</span><input name="b" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" type="password" required></label></div>
        <div class="err" id="err"></div><button class="btn block">${L('Tetapkan PIN', 'Set PIN')}</button></form>
      <p style="margin-top:1rem"><button class="linkbtn" data-act="setupdone">${L('Langkau, guna kata laluan sahaja', 'Skip, password only')}</button></p>`);
    root.querySelector('#fp').onsubmit = async e => {
      e.preventDefault();
      if (e.target.a.value !== e.target.b.value) { root.querySelector('#err').textContent = L('PIN tidak sama.', 'PINs do not match.'); return; }
      await V.setPin(e.target.a.value); afterUnlock();
    };
  } else if (st === 'restore') {
    root.innerHTML = wrap(`<h2>${L('Pulihkan dari fail', 'Restore from file')}</h2>
      <p class="small" style="margin:.4rem 0 1rem">${L('Pilih fail .eigengrau yang dieksport dari peranti lain (contoh dalam OneDrive), dan masukkan kata laluan peranti itu.', 'Pick the .eigengrau file exported from your other device (e.g. in OneDrive), and enter that device\'s password.')}</p>
      <form id="fr" style="text-align:left">
        <label class="f"><span>${L('Fail', 'File')}</span><input type="file" name="file" accept=".eigengrau,application/json" required></label>
        <label class="f"><span>${L('Kata laluan', 'Password')}</span><input type="password" name="pw" required></label>
        <div class="err" id="err"></div><button class="btn block">${L('Pulihkan', 'Restore')}</button></form>
      <p style="margin-top:1rem"><button class="linkbtn" data-act="setupstep" data-v="welcome">← ${L('Kembali', 'Back')}</button></p>`);
    root.querySelector('#fr').onsubmit = async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      try { await V.restoreFile(await e.target.file.files[0].text(), e.target.pw.value); toast(L('Data dipulihkan.', 'Data restored.')); afterUnlock(); }
      catch { root.querySelector('#err').textContent = L('Fail atau kata laluan tidak sah.', 'Invalid file or password.'); btn.disabled = false; }
    };
  }
}

// ---------- app shell -------------------------------------------------------
const NAV = () => [
  ['dashboard', 'i-home', L('Papan Utama', 'Dashboard'), L('Utama', 'Home')],
  ['timeline', 'i-tl', L('Garis Masa', 'Timeline'), L('Masa', 'Timeline')],
  ['tasks', 'i-task', L('Tugasan', 'Tasks'), L('Tugas', 'Tasks')],
  ['meetings', 'i-meet', L('Mesyuarat Penyelia', 'Supervisor Meetings'), L('Penyelia', 'Meetings')],
  ['literature', 'i-lit', L('Literatur', 'Literature'), L('Literatur', 'Library')],
];
function renderApp() {
  if (!V.isUnlocked()) return;
  const s = S();
  const counts = { tasks: s.tasks.filter(t => t.status !== 'done').length, literature: s.literature.length };
  const views = { dashboard: vDashboard, timeline: vTimeline, tasks: vTasks, meetings: vMeetings, literature: vLiterature, settings: vSettings };
  if (!views[route]) route = 'dashboard';
  const scrollY = window.scrollY;
  root.innerHTML = `<div class="app">
    <aside class="side"><div class="logo">${appIcon(30)}<b>Eigengrau</b></div>
      <nav class="nav">${NAV().map(n => `<a href="#${n[0]}" class="${route === n[0] ? 'on' : ''}">${ic(n[1])}${n[2]}${counts[n[0]] ? `<span class="count">${counts[n[0]]}</span>` : ''}</a>`).join('')}</nav>
      <div class="foot nav">
        <a class="small" style="cursor:default"><span style="width:.45rem;height:.45rem;border-radius:50%;background:var(--sage);display:inline-block"></span>${L('Disulitkan dalam peranti', 'Encrypted on device')}</a>
        <a data-act="lock">${ic('i-lock')}${L('Kunci sekarang', 'Lock now')}</a>
        <a href="#settings" class="${route === 'settings' ? 'on' : ''}">${ic('i-set')}${L('Tetapan', 'Settings')}</a>
      </div></aside>
    <main class="main">${views[route]()}</main>
    <nav class="tabbar">${NAV().map(n => `<a href="#${n[0]}" class="${route === n[0] ? 'on' : ''}">${ic(n[1])}${n[3]}</a>`).join('')}</nav>
  </div>`;
  window.scrollTo(0, scrollY);
  afterRender[route]?.();
}
const afterRender = {};
window.addEventListener('hashchange', () => { route = location.hash.slice(1) || 'dashboard'; if (view === 'app') { renderApp(); window.scrollTo(0, 0); } });
V.onChange(() => { if (view === 'app' && !modalEl.innerHTML) renderApp(); });

function topbar(title, sub, right = '') {
  return `<div class="top"><div><h1>${title}</h1>${sub ? `<div class="small">${sub}</div>` : ''}</div>
    <div class="right">${right}<span class="show-m"><button class="btn ghost" data-act="go" data-v="settings" aria-label="${L('Tetapan', 'Settings')}" style="padding:.45rem .55rem">${ic('i-set', 'ico')}</button></span><span class="hide-m">${langToggle()}</span></div></div>`;
}

// ---------- dashboard -------------------------------------------------------
function vDashboard() {
  const s = S(), m = s.meta, t = today(), tIso = iso(t);
  const cur = monthIndex(t), curM = Math.max(1, Math.floor(cur));
  const pct = Math.max(0, Math.min(100, Math.round((cur - 1) / m.totalMonths * 100)));
  const phase = s.phases.filter(p => p.start <= curM && curM <= p.end).sort((a, b) => a.start - b.start)[0];
  const phasePct = phase ? Math.min(100, Math.round((cur - phase.start) / (phase.end - phase.start + 1) * 100)) : 0;
  const late = s.milestones.filter(x => !x.done && x.date < tIso);
  const upcoming = s.milestones.filter(x => !x.done && x.date >= tIso).sort((a, b) => a.date.localeCompare(b.date));
  const [wa, wb] = weekRange();
  const week = s.tasks.filter(x => (x.status !== 'done' && x.due && x.due <= wb) || (x.status === 'done' && x.doneAt && x.doneAt >= wa && x.doneAt <= wb))
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9').localeCompare(b.due || '9'));
  const undated = s.tasks.filter(x => x.status !== 'done' && !x.due).sort((a, b) => (b.status === 'doing') - (a.status === 'doing') || a.createdAt - b.createdAt).slice(0, 5);
  const nextMeet = s.meetings.filter(x => x.date >= tIso).sort((a, b) => a.date.localeCompare(b.date))[0];
  const lit = st => s.literature.filter(x => x.status === st).length;
  const C = 2 * Math.PI * 50;
  const hello = (() => { const h = new Date().getHours(); return h < 12 ? L('Selamat pagi', 'Good morning') : h < 15 ? L('Selamat tengah hari', 'Good afternoon') : h < 19 ? L('Selamat petang', 'Good afternoon') : L('Selamat malam', 'Good evening'); })();
  const mcard = (x, lbl) => x ? `<div class="card" style="cursor:pointer" data-act="editms" data-id="${x.id}"><h3 class="t">${lbl}</h3>
      <div style="font-weight:600">${esc(x.title)}</div><div class="small">M${Math.floor(monthIndex(parse(x.date)))} · ${fmt(x.date)}</div>
      <div class="big" style="margin-top:.6rem;color:${daysUntil(x.date) <= 30 ? 'var(--amber)' : 'var(--text)'}">${daysUntil(x.date)} <span style="font-size:.85rem;color:var(--muted);font-weight:500">${L('hari lagi', 'days left')}</span></div></div>`
    : `<div class="card"><h3 class="t">${lbl}</h3><div class="empty">${L('Tiada', 'None')}</div></div>`;
  const taskRow = x => `<div class="trow"><button class="chk ${x.status === 'done' ? 'on' : ''}" data-act="toggletask" data-id="${x.id}" aria-label="done"></button><span class="t ${x.status === 'done' ? 'done' : ''}" data-act="edittask" data-id="${x.id}">${esc(x.title)}</span>${dueBadge(x.due, x.status === 'done')}</div>`;
  return `${topbar(`${hello}${m.name ? ', ' + esc(m.name) : ''}`, `${DAYF[lang][t.getDay()]}, ${fmt(tIso)} · ${L(`Bulan ${curM} daripada ${m.totalMonths}`, `Month ${curM} of ${m.totalMonths}`)}`,
    `<button class="btn" data-act="newtask">+ ${L('Tugasan', 'Task')}</button>`)}
  <div class="grid g4" style="margin-bottom:1rem">
    <div class="card" style="display:flex;gap:1rem;align-items:center">
      <svg width="110" height="110" viewBox="0 0 120 120" style="flex:none"><circle cx="60" cy="60" r="50" stroke="#2C2C39" stroke-width="10" fill="none"/>
        <circle cx="60" cy="60" r="50" stroke="#A99FD0" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" transform="rotate(-90 60 60)"/>
        <text x="60" y="60" text-anchor="middle" fill="#D9D6CE" font-size="26" font-weight="600" font-family="Inter">${pct}%</text>
        <text x="60" y="80" text-anchor="middle" fill="#A9A6B2" font-size="14" font-family="Inter">M${curM} / M${m.totalMonths}</text></svg>
      <div style="flex:1;min-width:0"><h3 class="t" style="margin-bottom:.3rem">${L('Kemajuan PhD', 'PhD progress')}</h3>
        <div style="font-size:1.1rem;font-weight:600">${phase ? esc(phase.title) : L('Tiada fasa aktif', 'No active phase')}</div>
        ${phase ? `<div class="bar"><i style="width:${phasePct}%;background:${cvar(phase.color)}"></i></div><div class="small" style="margin-top:.4rem">${L(`Masa fasa ${phasePct}% berlalu`, `${phasePct}% of phase time elapsed`)}</div>` : ''}
        <div style="margin-top:.5rem">${late.length ? `<span class="pill p-rose">${L(`${late.length} milestone lewat`, `${late.length} milestone(s) overdue`)}</span>` : `<span class="pill p-sage">${L('Ikut jadual', 'On track')}</span>`}</div>
      </div></div>
    ${mcard(upcoming[0], L('Milestone seterusnya', 'Next milestone'))}
    ${mcard(upcoming[1], L('Selepas itu', 'After that'))}
  </div>
  <div class="grid g2">
    <div class="card"><h3 class="t">${L('Minggu ini', 'This week')} <span class="pill p-grey">${week.filter(x => x.status === 'done').length} / ${week.length}</span><button class="linkbtn" data-act="go" data-v="tasks">${L('Lihat semua', 'View all')} →</button></h3>
      <div class="list">${week.map(taskRow).join('') || `<div class="empty">${L('Tiada tugasan bertarikh minggu ini.', 'No dated tasks this week.')}</div>`}</div>
      ${undated.length ? `<h3 class="t" style="margin-top:1rem">${L('Seterusnya (belum bertarikh)', 'Up next (no date)')}</h3><div class="list">${undated.map(taskRow).join('')}</div>` : ''}
    </div>
    <div class="grid" style="gap:1rem;align-content:start">
      <div class="card"><h3 class="t">${L('Perjumpaan penyelia seterusnya', 'Next supervisor meeting')}</h3>
        ${nextMeet ? `<div style="display:flex;gap:.8rem;align-items:center;cursor:pointer" data-act="openmeeting" data-id="${nextMeet.id}">
          <div style="background:var(--s3);border-radius:.6rem;padding:.4rem .75rem;text-align:center"><div class="small">${MON[lang][parse(nextMeet.date).getMonth()].toUpperCase()}</div><div style="font-size:1.25rem;font-weight:600">${parse(nextMeet.date).getDate()}</div></div>
          <div><div style="font-weight:600">${esc(nextMeet.title || s.meta.supervisor)}</div><div class="small">${DAY[lang][parse(nextMeet.date).getDay()]}${nextMeet.time ? ', ' + esc(nextMeet.time) : ''}</div></div></div>
          ${nextMeet.agenda ? `<div class="small" style="margin-top:.6rem;white-space:pre-wrap">${esc(nextMeet.agenda)}</div>` : ''}`
        : `<div class="small">${L('Belum dijadualkan.', 'Not scheduled yet.')}</div><button class="btn ghost" style="margin-top:.6rem" data-act="newmeeting">+ ${L('Jadualkan', 'Schedule')}</button>`}
      </div>
      <div class="card" style="cursor:pointer" data-act="go" data-v="literature"><h3 class="t">${L('Literatur', 'Literature')}${s.meta.zotero.lastSync ? '<span class="small" style="margin-left:auto;color:var(--lav)">Zotero ✓</span>' : ''}</h3>
        <div style="display:flex;gap:1.1rem;flex-wrap:wrap">
          <div><div class="big" style="color:var(--sage)">${lit('include')}</div><div class="small">Include</div></div>
          <div><div class="big" style="color:var(--amber)">${lit('maybe')}</div><div class="small">Maybe</div></div>
          <div><div class="big" style="color:var(--faint)">${lit('exclude')}</div><div class="small">Exclude</div></div>
          <div><div class="big" style="color:var(--slate)">${s.literature.filter(x => x.stars >= 5).length}</div><div class="small">${L('Wajib baca', 'Must-read')}</div></div>
        </div></div>
    </div>
  </div>`;
}

// ---------- timeline --------------------------------------------------------
function vTimeline() {
  const s = S(), n = s.meta.totalMonths, cur = monthIndex(today());
  const mode = ui.tlMode || (matchMedia('(max-width:760px)').matches ? 'list' : 'gantt');
  const pct = m => ((m - 1) / n * 100).toFixed(3) + '%';
  const right = `<div class="seg"><button data-act="tlmode" data-v="gantt" class="${mode === 'gantt' ? 'on' : ''}">${L('Carta', 'Chart')}</button><button data-act="tlmode" data-v="list" class="${mode === 'list' ? 'on' : ''}">${L('Senarai', 'List')}</button></div>
    <button class="btn ghost" data-act="newphase">+ ${L('Fasa', 'Phase')}</button><button class="btn" data-act="newms">+ Milestone</button>`;
  const ms = [...s.milestones].sort((a, b) => a.date.localeCompare(b.date));
  let body;
  if (mode === 'gantt') {
    const phases = [...s.phases].sort((a, b) => a.start - b.start);
    body = `<div class="card tlwrap"><div class="tl" style="--n:${n}">
      <div class="tl-months"><span></span>${Array.from({ length: n }, (_, i) => `<span title="${monthLabel(i + 1)}">M${i + 1}</span>`).join('')}</div>
      ${phases.map(p => `<div class="tl-row"><div class="lbl" data-act="editphase" data-id="${p.id}">${esc(p.title)}<small>${esc(p.note || '')}</small></div>
        <div class="track">${cur >= 1 && cur <= n + 1 ? `<div class="today" style="left:${pct(cur)}"></div>` : ''}
        <div class="bar-seg" data-act="editphase" data-id="${p.id}" title="${esc(p.title)} · M${p.start}–M${p.end}" style="left:${pct(p.start)};width:${((p.end - p.start + 1) / n * 100).toFixed(3)}%;background:${cvar(p.color)};${p.color === 'grey' ? 'color:var(--text)' : ''}">M${p.start}–M${p.end}</div></div></div>`).join('')}
      <div class="tl-row"><div class="lbl">Milestone<small>${L('Klik untuk ubah', 'Click to edit')}</small></div>
        <div class="track">${cur >= 1 && cur <= n + 1 ? `<div class="today" style="left:${pct(cur)}"></div>` : ''}${ms.map(x => { const mi = monthIndex(parse(x.date)); return mi >= 1 && mi < n + 1 ? `<div class="ms ${x.done ? 'done' : ''}" data-act="editms" data-id="${x.id}" title="${esc(x.title)} · ${fmt(x.date)}" style="left:${pct(mi)};background:${cvar(x.color)}"></div>` : ''; }).join('')}</div></div>
    </div><div class="small" style="margin-top:.6rem"><span style="color:var(--lav)">│</span> ${L('Hari ini', 'Today')} · M1 = ${monthLabel(1)}</div></div>
    <h2 style="margin:1.4rem 0 .8rem">Milestone</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))">${ms.map(msCard).join('')}</div>`;
  } else {
    const tIso = iso(today());
    body = `<div class="card mlist">${ms.map((x, i) => `<div class="mi"><div class="dotcol"><span class="d" style="background:${cvar(x.color)};${x.done ? 'opacity:.45' : ''}"></span>${i < ms.length - 1 ? '<span class="ln"></span>' : ''}</div>
      <div class="body" data-act="editms" data-id="${x.id}"><div class="small">M${Math.floor(monthIndex(parse(x.date)))} · ${fmt(x.date)} ${x.done ? `<span class="pill p-sage">✓ ${L('Siap', 'Done')}</span>` : x.date < tIso ? `<span class="pill p-rose">${L('Lewat', 'Overdue')}</span>` : ''}</div>
      <div style="font-weight:500;${x.done ? 'color:var(--faint)' : ''}">${esc(x.title)}</div></div></div>`).join('') || `<div class="empty">${L('Tiada milestone lagi.', 'No milestones yet.')}</div>`}</div>
      <h2 style="margin:1.4rem 0 .8rem">${L('Fasa', 'Phases')}</h2>
      <div class="card list">${[...s.phases].sort((a, b) => a.start - b.start).map(p => `<div class="trow" data-act="editphase" data-id="${p.id}" style="cursor:pointer"><span style="width:.7rem;height:.7rem;border-radius:.2rem;background:${cvar(p.color)}"></span><span class="t">${esc(p.title)}</span><span class="small">M${p.start}–M${p.end}</span></div>`).join('')}</div>`;
  }
  return topbar(L('Garis Masa', 'Timeline'), `${monthLabel(1)} – ${monthLabel(n)} · ${n} ${L('bulan', 'months')}`, right) + body;
}
function msCard(x) {
  const d = daysUntil(x.date);
  const pill = x.done ? `<span class="pill p-sage">✓ ${L('Siap', 'Done')}</span>` : d < 0 ? `<span class="pill p-rose">${L('Lewat', 'Overdue')}</span>` : `<span class="pill p-grey">${d} ${L('hari', 'days')}</span>`;
  return `<div class="card" style="cursor:pointer" data-act="editms" data-id="${x.id}"><div style="display:flex;gap:.4rem;align-items:center"><span class="pill" style="background:color-mix(in srgb, ${cvar(x.color)} 14%, transparent);color:${ctext(x.color)}">M${Math.floor(monthIndex(parse(x.date)))} · ${MON[lang][parse(x.date).getMonth()]} ${parse(x.date).getFullYear()}</span>${pill}</div>
    <div style="font-weight:600;margin-top:.5rem;${x.done ? 'color:var(--faint)' : ''}">${esc(x.title)}</div>${x.note ? `<div class="small">${esc(x.note)}</div>` : ''}</div>`;
}

// ---------- tasks -----------------------------------------------------------
const STATUSES = () => [['todo', L('Belum mula', 'To do'), 'faint'], ['doing', L('Sedang buat', 'In progress'), 'lav'], ['waiting', L('Menunggu orang lain', 'Waiting on others'), 'amber'], ['done', L('Siap', 'Done'), 'sage']];
const tagPill = tag => tag ? `<span class="pill ${tagClass(tag)}">${esc(tag)}</span>` : '';
function tagClass(tag) { const k = ['p-lav', 'p-slate', 'p-amber', 'p-sage', 'p-rose', 'p-grey']; let h = 0; for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0; return k[h % k.length]; }
function vTasks() {
  const s = S();
  const tags = [...new Set(s.tasks.map(t => t.tag).filter(Boolean))].sort();
  let list = s.tasks.filter(t => ui.taskFilter === 'all' || t.tag === ui.taskFilter);
  const sortT = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt - b.createdAt);
  const active = s.tasks.filter(t => t.status !== 'done').length;
  const right = `<div class="seg"><button data-act="taskmode" data-v="board" class="${ui.taskMode === 'board' ? 'on' : ''}">Board</button><button data-act="taskmode" data-v="list" class="${ui.taskMode === 'list' ? 'on' : ''}">${L('Senarai', 'List')}</button></div><button class="btn" data-act="newtask">+ ${L('Tugasan', 'Task')}</button>`;
  const chips = `<div class="chips"><span class="chip ${ui.taskFilter === 'all' ? 'on' : ''}" data-act="taskfilter" data-v="all">${L('Semua', 'All')}</span>${tags.map(t => `<span class="chip ${ui.taskFilter === t ? 'on' : ''}" data-act="taskfilter" data-v="${esc(t)}">${esc(t)}</span>`).join('')}</div>`;
  const card = t => `<div class="tk ${t.status === 'done' ? 'done' : ''}" draggable="true" data-act="edittask" data-id="${t.id}"><p>${esc(t.title)}</p><div class="meta">${tagPill(t.tag)}${t.meetingId ? `<span class="pill p-grey">${ic('i-meet', 'mini')}</span>` : ''}<span style="margin-left:auto">${dueBadge(t.due, t.status === 'done')}</span></div></div>`;
  let body;
  if (ui.taskMode === 'board') {
    body = `<div class="kan">${STATUSES().map(([k, lbl, c]) => { const items = list.filter(t => t.status === k).sort(k === 'done' ? (a, b) => (b.doneAt || '').localeCompare(a.doneAt || '') : sortT);
      return `<div class="col" data-drop="${k}"><h4><i style="background:var(--${c})"></i>${lbl} · ${items.length}</h4>${items.map(card).join('')}</div>`; }).join('')}</div>
      <p class="small hide-m" style="margin-top:.6rem">${L('Tip: seret kad untuk tukar status.', 'Tip: drag cards to change status.')}</p>`;
  } else {
    body = `<div class="card list">${list.sort((a, b) => (a.status === 'done') - (b.status === 'done') || sortT(a, b)).map(t => `<div class="trow"><button class="chk ${t.status === 'done' ? 'on' : ''}" data-act="toggletask" data-id="${t.id}" aria-label="done"></button><span class="t ${t.status === 'done' ? 'done' : ''}" data-act="edittask" data-id="${t.id}">${esc(t.title)}</span>${tagPill(t.tag)}${t.status === 'waiting' ? `<span class="pill p-amber">${L('Menunggu', 'Waiting')}</span>` : ''}${dueBadge(t.due, t.status === 'done')}</div>`).join('') || `<div class="empty">${L('Tiada tugasan.', 'No tasks.')}</div>`}</div>`;
  }
  return topbar(L('Tugasan', 'Tasks'), L(`${active} aktif`, `${active} active`), right) + chips + body;
}
afterRender.tasks = () => {
  root.querySelectorAll('.tk[draggable]').forEach(el => el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.id); }));
  root.querySelectorAll('[data-drop]').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', e => { e.preventDefault(); const t = S().tasks.find(x => x.id === e.dataTransfer.getData('text/plain')); if (t) setTaskStatus(t, col.dataset.drop); });
  });
};
function setTaskStatus(t, st) { V.upsert('tasks', { ...t, status: st, doneAt: st === 'done' ? (t.doneAt || iso(today())) : '' }); }

// ---------- meetings --------------------------------------------------------
function vMeetings() {
  const s = S(), tIso = iso(today());
  const up = s.meetings.filter(m => m.date >= tIso).sort((a, b) => a.date.localeCompare(b.date));
  const past = s.meetings.filter(m => m.date < tIso).sort((a, b) => b.date.localeCompare(a.date));
  if (!s.meetings.find(m => m.id === ui.meetingSel)) ui.meetingSel = (past[0] || up[0])?.id;
  const sel = s.meetings.find(m => m.id === ui.meetingSel);
  const item = (m, upc) => `<div class="mitem ${m.id === ui.meetingSel ? 'on' : ''} ${upc ? 'up' : ''}" data-act="selmeeting" data-id="${m.id}"><b ${upc ? 'style="color:var(--lav)"' : ''}>${upc ? L('Akan datang · ', 'Upcoming · ') : ''}${fmt(m.date)}</b><span class="small">${esc(m.title || L('Mesyuarat', 'Meeting'))}</span></div>`;
  const right = `<button class="btn" data-act="newmeeting">+ ${L('Mesyuarat baru', 'New meeting')}</button>`;
  if (!s.meetings.length) return topbar(L('Log Mesyuarat Penyelia', 'Supervisor Meeting Log'), esc(s.meta.supervisor), right) + `<div class="card empty">${L('Belum ada mesyuarat. Tekan “Mesyuarat baru” untuk rekod yang pertama.', 'No meetings yet. Press “New meeting” to log the first one.')}</div>`;
  let detail = '';
  if (sel) {
    const acts = s.tasks.filter(t => t.meetingId === sel.id);
    const sec = (h, v) => v ? `<h4>${h}</h4><div class="txt">${esc(v)}</div>` : '';
    detail = `<div class="card doc" style="padding:1.4rem 1.6rem">
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap"><h2>${esc(sel.title || L('Mesyuarat', 'Meeting'))}</h2>${sel.mode ? `<span class="pill p-grey">${esc(sel.mode)}</span>` : ''}<span class="small" style="margin-left:auto">${fmt(sel.date, true)}${sel.time ? ' · ' + esc(sel.time) : ''}</span></div>
      ${sec(L('Agenda', 'Agenda'), sel.agenda)}${sec(L('Perkara dibincang', 'Discussed'), sel.notes)}${sec(L('Keputusan', 'Decisions'), sel.decisions)}
      <h4>${L('Tindakan', 'Action items')} <span class="pill p-grey" style="margin-left:.3rem">${acts.filter(a => a.status === 'done').length} / ${acts.length}</span></h4>
      ${acts.map(a => `<div class="action"><button class="chk ${a.status === 'done' ? 'on' : ''}" data-act="toggletask" data-id="${a.id}"></button><span style="flex:1;cursor:pointer;${a.status === 'done' ? 'color:var(--faint);text-decoration:line-through' : ''}" data-act="edittask" data-id="${a.id}">${esc(a.title)}</span>${dueBadge(a.due, a.status === 'done')}</div>`).join('')}
      <form id="addaction" class="action" style="background:transparent;border:1px dashed var(--line)"><span style="color:var(--faint)">+</span><input name="t" placeholder="${L('Tambah tindakan (masuk terus ke Tugasan)', 'Add action item (goes straight to Tasks)')}"></form>
      <div style="display:flex;gap:.6rem;margin-top:1.2rem"><button class="btn ghost" data-act="editmeeting" data-id="${sel.id}">${L('Ubah', 'Edit')}</button></div></div>`;
  }
  return topbar(L('Log Mesyuarat Penyelia', 'Supervisor Meeting Log'), esc(s.meta.supervisor), right) +
    `<div class="split"><div class="card" style="padding:.6rem">${up.map(m => item(m, true)).join('')}${past.map(m => item(m)).join('')}</div>${detail}</div>`;
}
afterRender.meetings = () => {
  const f = root.querySelector('#addaction');
  if (f) f.onsubmit = e => { e.preventDefault(); const v = f.t.value.trim(); if (!v) return; V.upsert('tasks', { title: v, tag: L('Penyelia', 'Supervisor'), status: 'todo', due: '', notes: '', meetingId: ui.meetingSel }); setTimeout(() => root.querySelector('#addaction input')?.focus(), 30); };
};

// ---------- literature ------------------------------------------------------
const LSTAT = () => [['include', 'Include', 'p-sage'], ['maybe', 'Maybe', 'p-amber'], ['exclude', 'Exclude', 'p-grey'], ['', L('Belum saring', 'Unscreened'), 'p-slate']];
function vLiterature() {
  const s = S(), z = s.meta.zotero;
  const q = ui.litQ.toLowerCase();
  const tags = [...new Set(s.literature.flatMap(x => x.myTags || []))].sort();
  let list = s.literature.filter(x => (ui.litFilter === 'all' || (ui.litFilter === 'must' ? x.stars >= 5 : (x.status || '') === ui.litFilter))
    && (!ui.litTag || (x.myTags || []).includes(ui.litTag))
    && (!q || `${x.title} ${x.authors} ${x.year} ${(x.myTags || []).join(' ')} ${x.notes || ''}`.toLowerCase().includes(q)));
  list.sort((a, b) => (b.stars || 0) - (a.stars || 0) || String(b.year || '').localeCompare(String(a.year || '')) || a.title.localeCompare(b.title));
  const cnt = st => s.literature.filter(x => (x.status || '') === st).length;
  const shown = list.slice(0, 300);
  const right = `<input class="search" id="litq" placeholder="${L('Cari tajuk, penulis, tag…', 'Search title, author, tag…')}" value="${esc(ui.litQ)}">
    <button class="btn ghost" data-act="zsync">↻ Zotero</button><button class="btn" data-act="newlit">+ ${L('Tambah', 'Add')}</button>`;
  const sub = `${s.literature.length} ${L('dokumen', 'documents')}${z.lastSync ? ` · Zotero ${L('disegerak', 'synced')} ${new Date(z.lastSync).toLocaleString(lang === 'bm' ? 'ms-MY' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`;
  const chip = (k, lbl) => `<span class="chip ${ui.litFilter === k ? 'on' : ''}" data-act="litfilter" data-v="${k}">${lbl}</span>`;
  return topbar(L('Penjejak Literatur', 'Literature Tracker'), sub, right) +
    `<div class="chips">${chip('all', `${L('Semua', 'All')} ${s.literature.length}`)}${chip('include', `<span style="color:var(--sage)">●</span> Include ${cnt('include')}`)}${chip('maybe', `<span style="color:var(--amber)">●</span> Maybe ${cnt('maybe')}`)}${chip('exclude', `<span style="color:var(--faint)">●</span> Exclude ${cnt('exclude')}`)}${chip('', `${L('Belum saring', 'Unscreened')} ${cnt('')}`)}${chip('must', `★ ${L('Wajib baca', 'Must-read')}`)}
      ${tags.length ? `<select id="littag" style="width:auto;padding:.25rem .6rem;font-size:.85rem"><option value="">${L('Semua tag', 'All tags')}</option>${tags.map(t => `<option ${ui.litTag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}</div>
    ${s.literature.length ? `<div class="card" style="padding:.3rem .6rem;overflow-x:auto"><table><thead><tr><th>${L('Tajuk', 'Title')}</th><th class="hide-m">${L('Tahun', 'Year')}</th><th class="hide-m">Tag</th><th>Status</th><th class="hide-m">${L('Penting', 'Priority')}</th></tr></thead><tbody>
      ${shown.map(x => { const st = LSTAT().find(a => a[0] === (x.status || '')); return `<tr class="click" data-act="editlit" data-id="${x.id}"><td><div style="font-weight:500">${esc(x.title)}</div><div class="au">${esc(x.authors || '')}<span class="show-m">${x.year ? ' · ' + esc(x.year) : ''}</span></div></td><td class="hide-m">${esc(x.year || '')}</td><td class="hide-m">${(x.myTags || []).map(t => `<span class="pill p-slate" style="margin:.1rem">${esc(t)}</span>`).join('')}</td><td><span class="pill ${st[2]}">${st[1]}</span></td><td class="hide-m stars">${'★'.repeat(x.stars || 0)}<span class="off">${'★'.repeat(5 - (x.stars || 0))}</span></td></tr>`; }).join('')}
      </tbody></table>${list.length > shown.length ? `<div class="small" style="padding:.6rem">${L(`Menunjukkan 300 daripada ${list.length}. Guna carian untuk tapis.`, `Showing 300 of ${list.length}. Use search to filter.`)}</div>` : ''}${!list.length ? `<div class="empty">${L('Tiada padanan.', 'No matches.')}</div>` : ''}</div>`
    : `<div class="card empty" style="padding:2rem">${L('Belum ada rujukan. Sambung Zotero di Tetapan untuk import koleksi anda, atau tambah sendiri.', 'No references yet. Connect Zotero in Settings to import your library, or add them manually.')}<div style="margin-top:1rem;display:flex;gap:.6rem;justify-content:center"><button class="btn" data-act="go" data-v="settings">${L('Sambung Zotero', 'Connect Zotero')}</button></div></div>`}
    <p class="small" style="margin-top:.7rem">${L('Status, tag, bintang dan nota disimpan dalam Eigengrau (bersulit). Metadata & PDF kekal di Zotero.', 'Status, tags, stars and notes live in Eigengrau (encrypted). Metadata & PDFs stay in Zotero.')}</p>`;
}
afterRender.literature = () => {
  const q = root.querySelector('#litq');
  if (q) { q.oninput = () => { ui.litQ = q.value; const pos = q.selectionStart; renderApp(); const n = root.querySelector('#litq'); n.focus(); n.setSelectionRange(pos, pos); }; }
  const t = root.querySelector('#littag'); if (t) t.onchange = () => { ui.litTag = t.value; renderApp(); };
};

async function zoteroSync() {
  const z = S().meta.zotero;
  if (!z.userId || !z.apiKey) { toast(L('Masukkan User ID & API key Zotero dahulu.', 'Enter your Zotero User ID & API key first.')); location.hash = 'settings'; return; }
  toast(L('Menyegerak dengan Zotero…', 'Syncing with Zotero…'));
  const items = [];
  try {
    for (let start = 0; ; start += 100) {
      const r = await fetch(`https://api.zotero.org/users/${encodeURIComponent(z.userId)}/items/top?format=json&limit=100&start=${start}`, { headers: { 'Zotero-API-Key': z.apiKey, 'Zotero-API-Version': '3' } });
      if (r.status === 403) throw new Error(L('API key ditolak (semak kebenaran baca).', 'API key rejected (check read access).'));
      if (!r.ok) throw new Error(`Zotero ${r.status}`);
      const page = await r.json(); items.push(...page);
      if (page.length < 100) break;
    }
  } catch (e) { toast(L('Zotero gagal: ', 'Zotero failed: ') + (e.message || e)); return; }
  const byKey = new Map(S().literature.filter(x => x.zoteroKey).map(x => [x.zoteroKey, x]));
  let added = 0, updated = 0;
  for (const it of items) {
    const d = it.data; if (!d || d.itemType === 'attachment' || d.itemType === 'note') continue;
    const creators = (d.creators || []).map(c => c.lastName || c.name || '').filter(Boolean);
    const authors = creators.length > 3 ? `${creators[0]} et al.` : creators.join(', ');
    const year = (String(d.date || '').match(/\d{4}/) || [''])[0];
    const fields = { title: d.title || L('(tanpa tajuk)', '(untitled)'), authors, year, url: d.url || (d.DOI ? `https://doi.org/${d.DOI}` : ''), itemType: d.itemType, zoteroKey: it.key, zTags: (d.tags || []).map(t => t.tag) };
    const ex = byKey.get(it.key);
    if (ex) { if (ex.title !== fields.title || ex.authors !== authors || ex.year !== year) { Object.assign(ex, fields, { updatedAt: V.now() }); updated++; } }
    else { S().literature.push({ id: V.uid(), createdAt: V.now(), updatedAt: V.now(), status: '', stars: 0, myTags: [], notes: '', ...fields }); added++; }
  }
  S().meta.zotero.lastSync = Date.now(); V.setMeta({});
  toast(L(`Zotero: ${added} baru, ${updated} dikemaskini.`, `Zotero: ${added} new, ${updated} updated.`));
}

// ---------- settings --------------------------------------------------------
function vSettings() {
  const m = S().meta, z = m.zotero;
  const fsOK = 'showSaveFilePicker' in window;
  const sizes = [['s', L('Kecil', 'Small')], ['m', L('Sederhana', 'Medium')], ['l', L('Besar', 'Large')], ['xl', L('Sangat besar', 'Extra large')]];
  return topbar(L('Tetapan', 'Settings'), '') + `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));align-items:start">
  <div class="card"><h2 style="margin-bottom:.9rem">${L('Paparan', 'Display')}</h2>
    <label class="f"><span>${L('Bahasa', 'Language')}</span>${langToggle()}</label>
    <label class="f"><span>${L('Saiz teks', 'Text size')}</span><div class="seg">${sizes.map(([k, l]) => `<button data-act="size" data-v="${k}" class="${(prefs.size || 'm') === k ? 'on' : ''}">${l}</button>`).join('')}</div></label>
  </div>
  <div class="card"><h2 style="margin-bottom:.9rem">${L('Profil PhD', 'PhD profile')}</h2>
    <form id="fprof"><label class="f"><span>${L('Nama panggilan', 'Name')}</span><input name="name" value="${esc(m.name)}"></label>
    <div class="row2"><label class="f"><span>${L('Bulan mula (M1)', 'Start month (M1)')}</span><input type="month" name="startMonth" value="${esc(m.startMonth)}" required></label>
    <label class="f"><span>${L('Tempoh (bulan)', 'Duration (months)')}</span><input type="number" name="totalMonths" min="6" max="120" value="${m.totalMonths}" required></label></div>
    <label class="f"><span>${L('Penyelia', 'Supervisor')}</span><input name="supervisor" value="${esc(m.supervisor)}"></label>
    <button class="btn">${L('Simpan', 'Save')}</button></form>
  </div>
  <div class="card"><h2 style="margin-bottom:.9rem">${L('Keselamatan', 'Security')}</h2>
    <label class="f"><span>${L('Kunci automatik selepas tidak aktif', 'Auto-lock after inactivity')}</span><select id="autolock">${[2, 5, 10, 15, 30, 60].map(n => `<option value="${n}" ${m.autoLockMin === n ? 'selected' : ''}>${n} ${L('minit', 'min')}</option>`).join('')}</select></label>
    <div style="display:flex;flex-wrap:wrap;gap:.5rem">
      <button class="btn ghost" data-act="setpin">${L('Tetapkan / tukar PIN', 'Set / change PIN')}</button>
      <button class="btn ghost" data-act="removepin">${L('Buang PIN', 'Remove PIN')}</button>
      <button class="btn ghost" data-act="changepw">${L('Tukar kata laluan', 'Change password')}</button>
      <button class="btn ghost" data-act="newrec">${L('Jana kunci pemulihan baru', 'New recovery key')}</button>
    </div>
    <p class="small" style="margin-top:.8rem">${L('Data disulitkan dengan AES-256-GCM. Kunci diterbitkan dari kata laluan (PBKDF2, 600,000 pusingan) dan tidak pernah meninggalkan peranti.', 'Data is encrypted with AES-256-GCM. The key is derived from your password (PBKDF2, 600,000 rounds) and never leaves this device.')}</p>
  </div>
  <div class="card"><h2 style="margin-bottom:.4rem">${L('Sync & backup', 'Sync & backup')}</h2>
    <p class="small" style="margin-bottom:.9rem">${L('Simpan fail sync bersulit dalam folder OneDrive. Di peranti lain, pulihkan atau gabung fail yang sama. Suntingan terbaru menang.', 'Keep an encrypted sync file in your OneDrive folder. On another device, restore or merge the same file. The newest edit wins.')}</p>
    ${fsOK ? `<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.6rem"><button class="btn" data-act="syncnow">↻ ${L('Sync sekarang', 'Sync now')}</button><button class="btn ghost" data-act="pickfile">${L('Pilih / tukar fail sync', 'Choose / change sync file')}</button></div><div class="small" id="syncinfo" style="margin-bottom:.8rem"></div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:.5rem">
      <button class="btn ghost" data-act="export">${L('Eksport fail backup', 'Export backup file')}</button>
      <label class="btn ghost" style="cursor:pointer">${L('Import & gabung fail', 'Import & merge file')}<input type="file" id="importf" accept=".eigengrau,application/json" hidden></label>
    </div>
  </div>
  <div class="card"><h2 style="margin-bottom:.4rem">${L('Import dari Claude', 'Import from Claude')}</h2>
    <p class="small" style="margin-bottom:.9rem">${L('Selepas sesi dengan Claude, muat turun fail import (tugasan, milestone, mesyuarat, literatur) dan masukkan di sini. Anda boleh semak dahulu sebelum import.', 'After a session with Claude, download the import file (tasks, milestones, meetings, literature) and add it here. You can review it before importing.')}</p>
    <div style="display:flex;flex-wrap:wrap;gap:.5rem">
      <label class="btn" style="cursor:pointer">${L('Pilih fail import', 'Choose import file')}<input type="file" id="claudef" accept=".json,application/json,text/plain" hidden></label>
      <button class="btn ghost" data-act="pasteimport">${L('Tampal teks', 'Paste text')}</button>
    </div></div>
  <div class="card"><h2 style="margin-bottom:.4rem">Zotero</h2>
    <p class="small" style="margin-bottom:.9rem">${L('Cipta API key (baca sahaja) di', 'Create a read-only API key at')} <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener">zotero.org/settings/keys</a>. ${L('User ID tertera di halaman yang sama.', 'Your User ID is shown on the same page.')}</p>
    <form id="fzot"><label class="f"><span>User ID</span><input name="userId" value="${esc(z.userId)}" inputmode="numeric" autocomplete="off"></label>
    <label class="f"><span>API key</span><input name="apiKey" type="password" value="${esc(z.apiKey)}" autocomplete="off"></label>
    <div style="display:flex;gap:.5rem"><button class="btn">${L('Simpan', 'Save')}</button><button type="button" class="btn ghost" data-act="zsync">↻ ${L('Sync sekarang', 'Sync now')}</button></div></form>
  </div>
  <div class="card"><h2 style="margin-bottom:.4rem">${L('Zon bahaya', 'Danger zone')}</h2>
    <p class="small" style="margin-bottom:.9rem">${L('Padam semua data Eigengrau dari peranti ini. Eksport backup dahulu.', 'Delete all Eigengrau data from this device. Export a backup first.')}</p>
    <button class="btn danger" data-act="erase">${L('Padam semua data', 'Erase all data')}</button></div>
  </div><p class="small" style="margin-top:1rem">Eigengrau v1.1 · ${L('Install: guna menu browser “Install app” / “Add to Home Screen”.', 'Install: use the browser menu “Install app” / “Add to Home Screen”.')}</p>`;
}
afterRender.settings = async () => {
  root.querySelector('#fprof').onsubmit = e => { e.preventDefault(); const f = e.target; V.setMeta({ name: f.name.value.trim(), startMonth: f.startMonth.value, totalMonths: +f.totalMonths.value, supervisor: f.supervisor.value.trim() }); toast(L('Disimpan.', 'Saved.')); };
  root.querySelector('#fzot').onsubmit = e => { e.preventDefault(); V.setMeta({ zotero: { ...S().meta.zotero, userId: e.target.userId.value.trim(), apiKey: e.target.apiKey.value.trim() } }); toast(L('Disimpan.', 'Saved.')); };
  root.querySelector('#autolock').onchange = e => { V.setMeta({ autoLockMin: +e.target.value }); toast(L('Disimpan.', 'Saved.')); };
  root.querySelector('#claudef').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) reviewImport(await file.text()); };
  root.querySelector('#importf').onchange = async e => { const file = e.target.files[0]; if (file) await importMerge(await file.text()); };
  const info = root.querySelector('#syncinfo');
  if (info) { const h = await DB.get('synchandle'); info.textContent = h ? L(`Fail sync: ${h.name}`, `Sync file: ${h.name}`) : L('Belum pilih fail sync.', 'No sync file chosen yet.'); }
};

function reviewImport(text) {
  let data;
  try { data = parseImport(text); }
  catch (e) { toast(e.message === 'notimport' ? L('Ini bukan fail import Eigengrau.', 'This is not an Eigengrau import file.') : L('Fail tidak dapat dibaca.', 'Could not read the file.')); return; }
  const plan = planImport(data);
  const names = { tasks: L('Tugasan', 'Tasks'), milestones: 'Milestone', meetings: L('Mesyuarat', 'Meetings'), literature: L('Literatur', 'Literature') };
  const rows = Object.keys(names).filter(c => data[c].length).map(c => `<div style="margin-bottom:.8rem"><div style="display:flex;gap:.5rem;align-items:center"><b>${names[c]}</b>${plan[c].add ? `<span class="pill p-sage">+${plan[c].add} ${L('baru', 'new')}</span>` : ''}${plan[c].update ? `<span class="pill p-grey">${plan[c].update} ${L('kemaskini', 'update')}</span>` : ''}</div>
    <ul class="small" style="margin:.3rem 0 0 1.2rem">${data[c].slice(0, 8).map(x => `<li>${esc(x.title || fmt(x.date))}${x.date ? ' · ' + fmt(x.date) : x.due ? ' · ' + fmt(x.due) : ''}</li>`).join('')}${data[c].length > 8 ? `<li>${L(`dan ${data[c].length - 8} lagi`, `and ${data[c].length - 8} more`)}</li>` : ''}</ul></div>`).join('');
  if (!rows) { toast(L('Fail import kosong.', 'The import file is empty.')); return; }
  openModal(`<h2>${L('Semak import', 'Review import')}</h2>${data.title ? `<p class="muted" style="margin-bottom:.9rem">${esc(data.title)}</p>` : ''}${rows}
    <p class="small">${L('Item yang sudah ada dikemaskini, bukan diduplikasi. Status, bintang dan nota anda dikekalkan.', 'Existing items are updated, not duplicated. Your status, stars and notes are kept.')}</p>`,
    () => { applyImport(data, L('Penyelia', 'Supervisor')); toast(L('Import selesai.', 'Import done.')); }, { ok: L('Import', 'Import') });
}

async function importMerge(text) {
  try { await V.mergeFile(text); toast(L('Fail digabungkan.', 'File merged.')); }
  catch (e) {
    if (e.message === 'needpw' || e.message === 'badpw') {
      openModal(`<h2>${L('Kata laluan fail', 'File password')}</h2><p class="small" style="margin-bottom:.8rem">${L('Fail ini dari peranti dengan kunci berbeza. Masukkan kata laluan peranti itu.', 'This file comes from a device with different keys. Enter that device\'s password.')}</p>
        <label class="f"><input type="password" name="pw" required></label>`, async f => { try { await V.mergeFile(text, f.pw.value); toast(L('Fail digabungkan.', 'File merged.')); } catch { toast(L('Kata laluan salah.', 'Wrong password.')); return false; } });
    } else toast(L('Fail tidak sah.', 'Invalid file.'));
  }
}
async function download(text) {
  const blob = new Blob([text], { type: 'application/json' });
  const name = `eigengrau-${iso(today())}.eigengrau`;
  if ('showSaveFilePicker' in window) {
    try { const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Eigengrau', accept: { 'application/json': ['.eigengrau'] } }] }); const w = await h.createWritable(); await w.write(blob); await w.close(); toast(L('Backup disimpan.', 'Backup saved.')); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function pickSyncFile() {
  try {
    const h = await showSaveFilePicker({ suggestedName: 'eigengrau-sync.eigengrau', types: [{ description: 'Eigengrau', accept: { 'application/json': ['.eigengrau'] } }] });
    await DB.set('synchandle', h); await syncNow();
  } catch (e) { if (e.name !== 'AbortError') toast(String(e.message || e)); }
}
async function syncNow() {
  const h = await DB.get('synchandle');
  if (!h) return pickSyncFile();
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
    const text = await (await h.getFile()).text();
    if (text.trim()) { try { await V.mergeFile(text); } catch (e) { if (e.message === 'needpw') { toast(L('Fail sync dari kunci lain: guna “Import & gabung”.', 'Sync file has different keys: use “Import & merge”.')); return; } throw e; } }
    const w = await h.createWritable(); await w.write(await V.exportFile()); await w.close();
    toast(L('Sync selesai.', 'Sync done.')); renderApp();
  } catch (e) { toast(L('Sync gagal: ', 'Sync failed: ') + (e.message || e)); }
}

// ---------- modals / forms --------------------------------------------------
function openModal(html, onSubmit, extra = {}) {
  modalEl.innerHTML = `<div class="modal-bg"><form class="modal" id="mform">${html}<div class="acts">${extra.del ? `<button type="button" class="btn danger left" data-act="mdel">${L('Padam', 'Delete')}</button>` : ''}<button type="button" class="btn ghost" data-act="mclose">${L('Batal', 'Cancel')}</button><button class="btn">${extra.ok || L('Simpan', 'Save')}</button></div></form></div>`;
  const f = modalEl.querySelector('#mform');
  f.onsubmit = async e => { e.preventDefault(); const r = await onSubmit(f); if (r !== false) closeModal(); };
  modalEl.onclick = e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'mclose' || e.target.classList.contains('modal-bg')) closeModal();
    if (a === 'mdel' && confirmDel()) { extra.del(); closeModal(); }
    if (a === 'star') { const v = +e.target.dataset.v; f.stars.value = f.stars.value == v ? 0 : v; f.querySelectorAll('.starpick button').forEach(b => b.classList.toggle('on', +b.dataset.v <= +f.stars.value)); }
  };
  setTimeout(() => f.querySelector('input:not([type=hidden]),textarea')?.focus(), 30);
  return f;
}
let delArmed = 0;
function confirmDel() { // two taps instead of confirm(), which some viewers block
  if (Date.now() - delArmed < 3000) return true;
  delArmed = Date.now(); const b = modalEl.querySelector('[data-act=mdel]'); if (b) b.textContent = L('Tekan lagi untuk padam', 'Tap again to delete');
  return false;
}
function closeModal() { const had = !!modalEl.innerHTML; modalEl.innerHTML = ''; if (had && view === 'app') renderApp(); }
addEventListener('keydown', e => { if (e.key === 'Escape' && modalEl.innerHTML) closeModal(); });

const colorPick = cur => `<label class="f"><span>${L('Warna', 'Colour')}</span><div style="display:flex;gap:.5rem">${COLORS.map(c => `<label style="cursor:pointer"><input type="radio" name="color" value="${c}" ${c === (cur || 'lav') ? 'checked' : ''} style="display:none"><span style="display:block;width:1.8rem;height:1.8rem;border-radius:.5rem;background:var(--${c});outline-offset:2px" class="cdot"></span></label>`).join('')}</div></label>`;

function taskForm(t = {}) {
  const tags = [...new Set(S().tasks.map(x => x.tag).filter(Boolean))].sort();
  openModal(`<h2>${t.id ? L('Ubah tugasan', 'Edit task') : L('Tugasan baru', 'New task')}</h2>
    <label class="f"><span>${L('Tajuk', 'Title')}</span><input name="title" value="${esc(t.title)}" required></label>
    <div class="row2"><label class="f"><span>${L('Tarikh akhir', 'Due date')}</span><input type="date" name="due" value="${esc(t.due)}"></label>
    <label class="f"><span>Status</span><select name="status">${STATUSES().map(([k, l]) => `<option value="${k}" ${(t.status || 'todo') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f"><span>Tag</span><input name="tag" value="${esc(t.tag)}" list="taglist" placeholder="SLR, Proposal, Admin…"><datalist id="taglist">${tags.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <label class="f"><span>${L('Nota', 'Notes')}</span><textarea name="notes">${esc(t.notes)}</textarea></label>`,
    f => { const st = f.status.value; V.upsert('tasks', { ...t, title: f.title.value.trim(), due: f.due.value, status: st, tag: f.tag.value.trim(), notes: f.notes.value, doneAt: st === 'done' ? (t.doneAt || iso(today())) : '' }); },
    { del: t.id ? () => V.remove('tasks', t.id) : null });
}
function msForm(x = {}) {
  openModal(`<h2>${x.id ? L('Ubah milestone', 'Edit milestone') : L('Milestone baru', 'New milestone')}</h2>
    <label class="f"><span>${L('Tajuk', 'Title')}</span><input name="title" value="${esc(x.title)}" required></label>
    <div class="row2"><label class="f"><span>${L('Tarikh', 'Date')}</span><input type="date" name="date" value="${esc(x.date)}" required></label>
    <label class="f" style="display:flex;align-items:end;gap:.5rem;padding-bottom:.6rem"><input type="checkbox" name="done" ${x.done ? 'checked' : ''} style="width:auto"> ${L('Siap', 'Done')}</label></div>
    <label class="f"><span>${L('Nota', 'Note')}</span><input name="note" value="${esc(x.note)}"></label>${colorPick(x.color)}`,
    f => { V.upsert('milestones', { ...x, title: f.title.value.trim(), date: f.date.value, done: f.done.checked, note: f.note.value, color: f.color.value }); },
    { del: x.id ? () => V.remove('milestones', x.id) : null });
}
function phaseForm(p = {}) {
  const n = S().meta.totalMonths;
  openModal(`<h2>${p.id ? L('Ubah fasa', 'Edit phase') : L('Fasa baru', 'New phase')}</h2>
    <label class="f"><span>${L('Nama', 'Name')}</span><input name="title" value="${esc(p.title)}" required></label>
    <label class="f"><span>${L('Keterangan', 'Description')}</span><input name="note" value="${esc(p.note)}"></label>
    <div class="row2"><label class="f"><span>${L('Bulan mula', 'Start month')}</span><select name="start">${Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${(p.start || 1) === i + 1 ? 'selected' : ''}>M${i + 1} · ${monthLabel(i + 1)}</option>`).join('')}</select></label>
    <label class="f"><span>${L('Bulan tamat', 'End month')}</span><select name="end">${Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${(p.end || 3) === i + 1 ? 'selected' : ''}>M${i + 1} · ${monthLabel(i + 1)}</option>`).join('')}</select></label></div>${colorPick(p.color)}`,
    f => { const a = +f.start.value, b = +f.end.value; V.upsert('phases', { ...p, title: f.title.value.trim(), note: f.note.value, start: Math.min(a, b), end: Math.max(a, b), color: f.color.value }); },
    { del: p.id ? () => V.remove('phases', p.id) : null });
}
function meetingForm(m = {}) {
  const sup = S().meta.supervisor;
  openModal(`<h2>${m.id ? L('Ubah mesyuarat', 'Edit meeting') : L('Mesyuarat baru', 'New meeting')}</h2>
    <label class="f"><span>${L('Tajuk / topik', 'Title / topic')}</span><input name="title" value="${esc(m.title)}" placeholder="${L('cth. Semakan protokol SLR', 'e.g. SLR protocol review')}"></label>
    <div class="row2"><label class="f"><span>${L('Tarikh', 'Date')}</span><input type="date" name="date" value="${esc(m.date || iso(today()))}" required></label>
    <label class="f"><span>${L('Masa', 'Time')}</span><input type="time" name="time" value="${esc(m.time)}"></label></div>
    <label class="f"><span>${L('Cara', 'Mode')}</span><input name="mode" value="${esc(m.mode)}" list="modes" placeholder="${L('Bersemuka / Teams', 'In person / Teams')}"><datalist id="modes"><option value="${L('Bersemuka', 'In person')}"><option value="Teams"><option value="Google Meet"><option value="${L('Emel', 'Email')}"></datalist></label>
    <label class="f"><span>${L('Agenda', 'Agenda')}</span><textarea name="agenda">${esc(m.agenda)}</textarea></label>
    <label class="f"><span>${L('Perkara dibincang', 'Discussed')}</span><textarea name="notes">${esc(m.notes)}</textarea></label>
    <label class="f"><span>${L('Keputusan', 'Decisions')}</span><textarea name="decisions">${esc(m.decisions)}</textarea></label>
    ${m.id ? '' : `<label class="f"><span>${L('Tindakan (satu baris satu tindakan, masuk ke Tugasan)', 'Action items (one per line, added to Tasks)')}</span><textarea name="actions"></textarea></label>`}
    <p class="small">${esc(sup)}</p>`,
    f => {
      const saved = V.upsert('meetings', { ...m, title: f.title.value.trim(), date: f.date.value, time: f.time.value, mode: f.mode.value.trim(), agenda: f.agenda.value, notes: f.notes.value, decisions: f.decisions.value });
      if (f.actions) f.actions.value.split('\n').map(x => x.trim()).filter(Boolean).forEach(title => V.upsert('tasks', { title, tag: L('Penyelia', 'Supervisor'), status: 'todo', due: '', notes: '', meetingId: saved.id }));
      ui.meetingSel = saved.id;
    },
    { del: m.id ? () => V.remove('meetings', m.id) : null });
}
function litForm(x = {}) {
  const st = x.status || '';
  openModal(`<h2>${x.id ? L('Ubah rujukan', 'Edit reference') : L('Rujukan baru', 'New reference')}</h2>
    ${x.zoteroKey ? `<p class="small" style="margin-bottom:.8rem">${L('Dari Zotero. Tajuk/penulis/tahun dikemaskini semasa sync.', 'From Zotero. Title/authors/year update on sync.')}</p>` : ''}
    <label class="f"><span>${L('Tajuk', 'Title')}</span><input name="title" value="${esc(x.title)}" required></label>
    <div class="row2"><label class="f"><span>${L('Penulis', 'Authors')}</span><input name="authors" value="${esc(x.authors)}"></label>
    <label class="f"><span>${L('Tahun', 'Year')}</span><input name="year" value="${esc(x.year)}" inputmode="numeric"></label></div>
    <div class="row2"><label class="f"><span>Status</span><select name="status">${LSTAT().map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>${L('Penting', 'Priority')} (★5 = ${L('wajib baca', 'must-read')})</span><input type="hidden" name="stars" value="${x.stars || 0}"><div class="starpick">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-act="star" data-v="${v}" class="${v <= (x.stars || 0) ? 'on' : ''}">★</button>`).join('')}</div></label></div>
    <label class="f"><span>${L('Tag (pisah dengan koma)', 'Tags (comma separated)')}</span><input name="tags" value="${esc((x.myTags || []).join(', '))}" placeholder="SRQ1, DMRI, ${L('Teori', 'Theory')}"></label>
    <label class="f"><span>URL / DOI</span><input name="url" value="${esc(x.url)}"></label>
    ${x.url ? `<p style="margin:-.4rem 0 .8rem"><a href="${esc(x.url)}" target="_blank" rel="noopener">${L('Buka pautan', 'Open link')} ↗</a></p>` : ''}
    <label class="f"><span>${L('Nota', 'Notes')}</span><textarea name="notes">${esc(x.notes)}</textarea></label>`,
    f => { V.upsert('literature', { ...x, title: f.title.value.trim(), authors: f.authors.value.trim(), year: f.year.value.trim(), status: f.status.value, stars: +f.stars.value, myTags: f.tags.value.split(',').map(s => s.trim()).filter(Boolean), url: f.url.value.trim(), notes: f.notes.value }); },
    { del: x.id ? () => V.remove('literature', x.id) : null });
}

// ---------- click actions ---------------------------------------------------
const find = (c, id) => S()[c].find(x => x.id === id);
const actions = {
  lang: el => setLang(el.dataset.v),
  size: el => setSize(el.dataset.v),
  lock: () => doLock(),
  go: el => { location.hash = el.dataset.v; },
  lockmode: el => showLock(el.dataset.v),
  pinkey: el => pinKey(el.dataset.v),
  setupstep: el => { setup.step = el.dataset.v; renderSetup(); },
  setupdone: () => afterUnlock(),
  create: async el => {
    root.querySelectorAll('[data-act=create]').forEach(b => { b.disabled = true; b.style.opacity = .6; });
    const st = el.dataset.v === 'seed' ? seedState(setup.name) : Object.assign(V.emptyState(), {});
    st.meta.name = setup.name; st.meta.lang = lang; st.meta.textSize = prefs.size || 'm';
    setup.recovery = await V.create(setup.pw, st); setup.pw = '';
    setup.step = 'recovery'; renderSetup();
  },
  copyrec: async () => { try { await navigator.clipboard.writeText(setup.recovery); toast(L('Disalin.', 'Copied.')); } catch { toast(L('Tidak dapat salin, sila tulis secara manual.', 'Could not copy, please write it down.')); } },
  newtask: () => taskForm({ status: 'todo' }),
  edittask: el => taskForm(find('tasks', el.dataset.id)),
  toggletask: el => { const t = find('tasks', el.dataset.id); setTaskStatus(t, t.status === 'done' ? 'todo' : 'done'); },
  taskfilter: el => { ui.taskFilter = el.dataset.v; renderApp(); },
  taskmode: el => { ui.taskMode = el.dataset.v; renderApp(); },
  tlmode: el => { ui.tlMode = el.dataset.v; renderApp(); },
  newms: () => msForm({ date: iso(today()), color: 'lav' }),
  editms: el => msForm(find('milestones', el.dataset.id)),
  newphase: () => phaseForm({ color: 'slate' }),
  editphase: el => phaseForm(find('phases', el.dataset.id)),
  newmeeting: () => meetingForm({}),
  editmeeting: el => meetingForm(find('meetings', el.dataset.id)),
  selmeeting: el => { ui.meetingSel = el.dataset.id; renderApp(); },
  openmeeting: el => { ui.meetingSel = el.dataset.id; location.hash = 'meetings'; },
  newlit: () => litForm({}),
  editlit: el => litForm(find('literature', el.dataset.id)),
  litfilter: el => { ui.litFilter = el.dataset.v; renderApp(); },
  zsync: () => zoteroSync(),
  export: async () => download(await V.exportFile()),
  pasteimport: () => openModal(`<h2>${L('Tampal teks import', 'Paste import text')}</h2><p class="small" style="margin-bottom:.8rem">${L('Salin teks import yang Claude beri (bermula dengan {"app": "eigengrau-import"…) dan tampal di sini.', 'Copy the import text Claude gave you (starting with {"app": "eigengrau-import"…) and paste it here.')}</p><label class="f"><textarea name="t" style="min-height:12rem;font-family:ui-monospace,monospace;font-size:.85rem" required></textarea></label>`,
    f => { const t = f.t.value; setTimeout(() => reviewImport(t), 50); }, { ok: L('Semak', 'Review') }),
  syncnow: () => syncNow(),
  pickfile: () => pickSyncFile(),
  setpin: () => openModal(`<h2>${L('Tetapkan PIN', 'Set PIN')}</h2><p class="small" style="margin-bottom:.8rem">${L('6 digit. Kata laluan diperlukan semula selepas 5 cubaan salah atau 14 hari.', '6 digits. Password is required again after 5 wrong tries or 14 days.')}</p>
      <div class="row2"><label class="f"><span>PIN</span><input name="a" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><label class="f"><span>${L('Ulang PIN', 'Repeat PIN')}</span><input name="b" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label></div>`,
    async f => { if (f.a.value !== f.b.value) { toast(L('PIN tidak sama.', 'PINs do not match.')); return false; } await V.setPin(f.a.value); toast(L('PIN ditetapkan.', 'PIN set.')); }),
  removepin: async () => { await V.removePin(); toast(L('PIN dibuang.', 'PIN removed.')); },
  changepw: () => openModal(`<h2>${L('Tukar kata laluan', 'Change password')}</h2>
      <label class="f"><span>${L('Kata laluan semasa', 'Current password')}</span><input name="o" type="password" required></label>
      <label class="f"><span>${L('Kata laluan baru (min. 8)', 'New password (min. 8)')}</span><input name="a" type="password" minlength="8" required></label>
      <label class="f"><span>${L('Ulang kata laluan baru', 'Repeat new password')}</span><input name="b" type="password" minlength="8" required></label>`,
    async f => { if (f.a.value !== f.b.value) { toast(L('Kata laluan tidak sama.', 'Passwords do not match.')); return false; } try { await V.changePassword(f.o.value, f.a.value); toast(L('Kata laluan ditukar. Eksport backup baru.', 'Password changed. Export a new backup.')); } catch { toast(L('Kata laluan semasa salah.', 'Current password is wrong.')); return false; } }),
  newrec: async () => { const k = await V.newRecovery(); openModal(`<h2>${L('Kunci pemulihan baru', 'New recovery key')}</h2><p class="small">${L('Kunci lama tidak sah lagi. Simpan yang ini.', 'The old key no longer works. Save this one.')}</p><div class="reckey">${esc(k)}</div>`, () => {}, { ok: L('Dah simpan', 'Saved it') }); },
  erase: () => openModal(`<h2>${L('Padam semua data?', 'Erase all data?')}</h2><p class="small" style="margin-bottom:.8rem">${L('Taip PADAM untuk sahkan. Tindakan ini tidak boleh dibatalkan.', 'Type ERASE to confirm. This cannot be undone.')}</p><label class="f"><input name="c" required autocomplete="off"></label>`,
    async f => { if (f.c.value.trim().toUpperCase() !== L('PADAM', 'ERASE')) return false; await V.eraseAll(); try { localStorage.removeItem('eg-prefs'); } catch {} modalEl.innerHTML = ''; showSetup(); }, { ok: L('Padam', 'Erase') }),
};
root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

boot();
