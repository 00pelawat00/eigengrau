// The vault: holds the decrypted state in memory only while unlocked.
import * as C from './crypto.js';
import * as DB from './db.js';

const PIN_MAX_FAILS = 5;
const PIN_MAX_DAYS = 14; // after this, the password is required again

let dek = null;
export let state = null;
let saveTimer = null;
const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export const isUnlocked = () => !!dek;
export async function hasVault() { return !!(await DB.get('keyring')); }
export async function pinInfo() {
  const k = await DB.get('keyring');
  if (!k?.pin) return null;
  const ageDays = (Date.now() - k.pin.setAt) / 864e5;
  if (ageDays > PIN_MAX_DAYS) return null;
  return k.pin;
}

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

export function emptyState() {
  return {
    v: 1,
    meta: { lang: 'bm', textSize: 'm', autoLockMin: 10, name: '', startMonth: '2026-09', totalMonths: 24,
      supervisor: 'Prof. Ts. Dr. Noor Afiza Mat Razali', zotero: { userId: '', apiKey: '', lastSync: 0 }, updatedAt: now() },
    phases: [], milestones: [], tasks: [], meetings: [], literature: [], tombstones: {}
  };
}

// --- setup / unlock -------------------------------------------------------
export async function create(password, initialState) {
  dek = await C.newDataKey();
  const recovery = C.newRecoveryKey();
  const keyring = { v: 1, pw: await C.wrapWith(dek, password), rec: await C.wrapWith(dek, recovery.replace(/-/g, '')), pin: null };
  await DB.set('keyring', keyring);
  state = initialState;
  await saveNow();
  return recovery;
}

export async function unlockPassword(password) {
  const k = await DB.get('keyring');
  dek = await C.unwrapWith(k.pw, password);
  await load();
}

export async function unlockRecovery(recovery, newPassword) {
  const k = await DB.get('keyring');
  dek = await C.unwrapWith(k.rec, recovery.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  k.pw = await C.wrapWith(dek, newPassword);
  k.pin = null;
  await DB.set('keyring', k);
  await load();
}

export async function unlockPin(pin) {
  const k = await DB.get('keyring');
  try {
    dek = await C.unwrapWith(k.pin, pin);
  } catch (e) {
    k.pin.fails = (k.pin.fails || 0) + 1;
    const left = PIN_MAX_FAILS - k.pin.fails;
    if (left <= 0) k.pin = null; // too many tries: PIN removed, password needed
    await DB.set('keyring', k);
    const err = new Error('badpin'); err.left = Math.max(left, 0); throw err;
  }
  k.pin.fails = 0;
  await DB.set('keyring', k);
  await load();
}

async function load() {
  const box = await DB.get('vault');
  state = await C.decryptJSON(dek, box);
  state = { ...emptyState(), ...state, meta: { ...emptyState().meta, ...state.meta } };
}

export function lock() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  dek = null; state = null;
}

// --- keys management ------------------------------------------------------
export async function setPin(pin) {
  const k = await DB.get('keyring');
  k.pin = { ...(await C.wrapWith(dek, pin, 300000)), fails: 0, setAt: now() };
  await DB.set('keyring', k);
}
export async function removePin() { const k = await DB.get('keyring'); k.pin = null; await DB.set('keyring', k); }

export async function changePassword(oldPw, newPw) {
  const k = await DB.get('keyring');
  await C.unwrapWith(k.pw, oldPw); // throws if wrong
  k.pw = await C.wrapWith(dek, newPw);
  await DB.set('keyring', k);
}
export async function newRecovery() {
  const k = await DB.get('keyring');
  const recovery = C.newRecoveryKey();
  k.rec = await C.wrapWith(dek, recovery.replace(/-/g, ''));
  await DB.set('keyring', k);
  return recovery;
}
export async function eraseAll() { lock(); await DB.clear(); }

// --- saving ---------------------------------------------------------------
export function changed() {
  listeners.forEach(fn => fn());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
export async function saveNow() {
  saveTimer = null;
  if (!dek || !state) return;
  await DB.set('vault', await C.encryptJSON(dek, state));
}

// --- CRUD helpers ---------------------------------------------------------
export function upsert(coll, item) {
  const list = state[coll];
  item.updatedAt = now();
  if (!item.id) { item.id = uid(); item.createdAt = item.updatedAt; list.push(item); }
  else { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item); }
  changed();
  return item;
}
export function remove(coll, id) {
  state[coll] = state[coll].filter(x => x.id !== id);
  state.tombstones[id] = now();
  changed();
}
export function setMeta(patch) { Object.assign(state.meta, patch, { updatedAt: now() }); changed(); }

// --- backup / sync file ---------------------------------------------------
const COLLS = ['phases', 'milestones', 'tasks', 'meetings', 'literature'];

export async function exportFile() {
  await saveNow();
  const k = await DB.get('keyring');
  return JSON.stringify({ app: 'eigengrau', v: 1, exportedAt: now(), keyring: { pw: k.pw, rec: k.rec }, vault: await DB.get('vault') });
}

function parseFile(text) {
  const f = JSON.parse(text);
  if (f.app !== 'eigengrau' || !f.keyring || !f.vault) throw new Error('notfile');
  return f;
}

// Restore onto a device with no vault yet (keeps the same keys).
export async function restoreFile(text, password) {
  const f = parseFile(text);
  const key = await C.unwrapWith(f.keyring.pw, password); // throws if wrong
  await C.decryptJSON(key, f.vault);
  await DB.set('keyring', { v: 1, pw: f.keyring.pw, rec: f.keyring.rec, pin: null });
  await DB.set('vault', f.vault);
  dek = key; await load();
}

// Merge a sync file into the unlocked vault. Newest edit wins per item.
export async function mergeFile(text, password) {
  const f = parseFile(text);
  let other;
  try { other = await C.decryptJSON(dek, f.vault); } // same keys (restored device)
  catch (e) {
    if (!password) throw new Error('needpw');
    let key;
    try { key = await C.unwrapWith(f.keyring.pw, password); } catch (e2) { throw new Error('badpw'); }
    other = await C.decryptJSON(key, f.vault);
  }
  mergeState(other);
  await saveNow();
}

export function mergeState(other) {
  const tomb = { ...(other.tombstones || {}), ...state.tombstones };
  for (const [id, t] of Object.entries(other.tombstones || {})) tomb[id] = Math.max(t, state.tombstones[id] || 0);
  for (const c of COLLS) {
    const map = new Map();
    for (const x of [...(state[c] || []), ...(other[c] || [])]) {
      const cur = map.get(x.id);
      if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) map.set(x.id, x);
    }
    state[c] = [...map.values()].filter(x => !(tomb[x.id] && tomb[x.id] >= (x.updatedAt || 0)));
  }
  state.tombstones = tomb;
  if ((other.meta?.updatedAt || 0) > (state.meta.updatedAt || 0)) {
    const keepLocal = { lang: state.meta.lang, textSize: state.meta.textSize };
    state.meta = { ...state.meta, ...other.meta, ...keepLocal };
  }
  listeners.forEach(fn => fn());
}
