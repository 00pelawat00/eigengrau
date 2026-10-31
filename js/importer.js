// Import files prepared by Claude (plain JSON, see docs/IMPORT-FORMAT.md).
import * as V from './vault.js';

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
const STAT = ['todo', 'doing', 'waiting', 'done'];
const LST = ['include', 'maybe', 'exclude', ''];
const COL = ['lav', 'sage', 'amber', 'rose', 'slate', 'grey'];

export function parseImport(text) {
  let f;
  try { f = JSON.parse(text.trim().replace(/^```(json)?|```$/g, '')); } catch { throw new Error('json'); }
  if (!f || f.app !== 'eigengrau-import') throw new Error('notimport');
  const arr = k => (Array.isArray(f[k]) ? f[k].slice(0, 2000) : []);
  return {
    title: str(f.title, 200),
    tasks: arr('tasks').filter(x => x?.title).map(x => ({ ref: str(x.ref, 100), title: str(x.title, 500), due: isoDate(x.due), tag: str(x.tag, 60), status: STAT.includes(x.status) ? x.status : 'todo', notes: str(x.notes) })),
    milestones: arr('milestones').filter(x => x?.title && isoDate(x.date)).map(x => ({ ref: str(x.ref, 100), title: str(x.title, 500), date: x.date, done: !!x.done, note: str(x.note, 500), color: COL.includes(x.color) ? x.color : 'lav' })),
    meetings: arr('meetings').filter(x => isoDate(x?.date)).map(x => ({ ref: str(x.ref, 100), title: str(x.title, 300), date: x.date, time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '', mode: str(x.mode, 60), agenda: str(x.agenda), notes: str(x.notes), decisions: str(x.decisions), actions: (Array.isArray(x.actions) ? x.actions : []).slice(0, 50).map(a => (typeof a === 'string' ? { title: a } : a)).filter(a => a?.title).map(a => ({ title: str(a.title, 500), due: isoDate(a.due) })) })),
    literature: arr('literature').filter(x => x?.title).map(x => ({ ref: str(x.ref, 100), title: str(x.title, 500), authors: str(x.authors, 300), year: str(x.year, 10), status: LST.includes(x.status) ? x.status : '', stars: Math.max(0, Math.min(5, parseInt(x.stars) || 0)), myTags: (Array.isArray(x.tags) ? x.tags : []).map(t => str(t, 40)).filter(Boolean).slice(0, 20), url: /^https?:\/\//.test(x.url || '') ? str(x.url, 500) : '', notes: str(x.notes) })),
  };
}

const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
function findExisting(coll, x) {
  const list = V.state[coll];
  if (x.ref) { const hit = list.find(y => y.importRef === x.ref); if (hit) return hit; }
  return list.find(y => norm(y.title || '') === norm(x.title || '') && (coll === 'meetings' || coll === 'milestones' ? y.date === x.date : true));
}

// Returns counts per collection: { tasks: {add, update}, ... }
export function planImport(data) {
  const out = {};
  for (const c of ['tasks', 'milestones', 'meetings', 'literature']) {
    out[c] = { add: 0, update: 0 };
    for (const x of data[c]) findExisting(c, x) ? out[c].update++ : out[c].add++;
  }
  return out;
}

export function applyImport(data, supervisorTag) {
  const up = (c, x, keepLocal = []) => {
    const { ref, ...fields } = x;
    const ex = findExisting(c, x);
    if (ex) { const keep = {}; keepLocal.forEach(k => { if (ex[k] !== undefined && ex[k] !== '' && !(Array.isArray(ex[k]) && !ex[k].length)) keep[k] = ex[k]; }); return V.upsert(c, { ...ex, ...fields, ...keep, importRef: ref || ex.importRef || '' }); }
    return V.upsert(c, { ...fields, importRef: ref || '' });
  };
  data.tasks.forEach(x => up('tasks', x, ['status', 'doneAt']));
  data.milestones.forEach(x => up('milestones', x, ['done']));
  data.literature.forEach(x => up('literature', x, ['status', 'stars', 'myTags', 'notes']));
  data.meetings.forEach(x => {
    const { actions, ...m } = x;
    const saved = up('meetings', m);
    actions.forEach(a => { if (!V.state.tasks.some(t => t.meetingId === saved.id && norm(t.title) === norm(a.title))) V.upsert('tasks', { title: a.title, due: a.due, tag: supervisorTag, status: 'todo', notes: '', meetingId: saved.id }); });
  });
}
