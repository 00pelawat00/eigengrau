// Starter plan built from Lynn's PhD plan (DEFEND-PQC, M1 = Sep 2026).
import { emptyState, uid, now } from './vault.js';

export function seedState(name) {
  const s = emptyState();
  s.meta.name = name || '';
  const t = now();
  const mk = o => ({ id: uid(), createdAt: t, updatedAt: t, ...o });
  s.phases = [
    ['Fasa 1 · SLR', 'Kitchenham, PRISMA 2020', 1, 6, 'lav'],
    ['Analisis dokumen', 'Polisi nasional & antarabangsa', 4, 9, 'slate'],
    ['Temu bual pakar', '15–20 pakar, analisis tematik', 7, 11, 'slate'],
    ['Fasa 2 · AHP & Delphi', 'AHP / fuzzy AHP, Delphi 2 pusingan', 11, 16, 'amber'],
    ['Fasa 3 · Kajian kes', 'Senario & DMRI', 15, 18, 'rose'],
    ['Fasa 4 · Validasi', 'Analisis sensitiviti', 17, 19, 'sage'],
    ['Penulisan tesis', 'Draf penuh → serahan', 19, 23, 'grey'],
  ].map(([title, note, start, end, color]) => mk({ title, note, start, end, color }));
  s.milestones = [
    ['Protokol SLR v1.0 siap', '2026-10-22', true, 'lav'],
    ['Kelulusan etika', '2027-01-31', false, 'amber'],
    ['Kertas 1 (SLR) dihantar', '2027-02-28', false, 'lav'],
    ['Pembentangan proposal', '2027-03-31', false, 'amber'],
    ['Temu bual siap', '2027-07-31', false, 'slate'],
    ['Kertas 2 (analisis jurang) dihantar', '2027-08-31', false, 'lav'],
    ['Framework v1', '2027-12-31', false, 'amber'],
    ['Kertas 3 (model keutamaan + indeks) dihantar', '2028-01-31', false, 'lav'],
    ['Validasi siap', '2028-03-31', false, 'sage'],
    ['Draf penuh tesis', '2028-05-31', false, 'grey'],
    ['Serahan tesis', '2028-07-31', false, 'rose'],
  ].map(([title, date, done, color]) => mk({ title, date, done, color }));
  s.tasks = [
    ['Bincang DSR vs CR dengan penyelia', 'Penyelia', 'todo'],
    ['Pilot search string di Scopus, IEEE Xplore, ACM (perpustakaan UPNM)', 'SLR', 'todo'],
    ['Nyahduplikasi & saring eksport pangkalan data', 'SLR', 'todo'],
    ['Bina helaian ekstrak data (protokol Seksyen 6)', 'SLR', 'todo'],
    ['Isi 3 placeholder kuning dalam proposal v6', 'Proposal', 'todo'],
    ['Sahkan 3 rujukan (tahun MCSS, penerbit Brunei, volum Hale)', 'Proposal', 'todo'],
    ['Sahkan syarat penerbitan dengan CGS', 'Admin', 'todo'],
    ['Tetapkan Gantt B2 = 1 Sep 2026', 'Admin', 'todo'],
    ['Padam PDF lepas dalam folder Literature', 'Admin', 'todo'],
  ].map(([title, tag, status]) => mk({ title, tag, status, due: '', notes: '' }));
  return s;
}
