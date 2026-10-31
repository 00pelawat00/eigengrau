# Eigengrau import file format (v1)

Claude prepares these after a session; Lynn imports them in **Tetapan → Import dari Claude**
(choose file or paste text). The file is plain JSON, never contains passwords, and is
reviewed in the app before anything is saved.

```json
{
  "app": "eigengrau-import",
  "v": 1,
  "title": "Sesi 31 Okt 2026: semakan protokol SLR",
  "tasks": [
    { "ref": "task-pilot-scopus", "title": "Pilot search string di Scopus", "due": "2026-11-07", "tag": "SLR", "status": "todo", "notes": "" }
  ],
  "milestones": [
    { "ref": "ms-ethics", "title": "Kelulusan etika", "date": "2027-01-31", "done": false, "note": "", "color": "amber" }
  ],
  "meetings": [
    { "ref": "meet-2026-11-06", "title": "Semakan protokol SLR", "date": "2026-11-06", "time": "10:00", "mode": "Bersemuka",
      "agenda": "…", "notes": "…", "decisions": "…",
      "actions": [ "Hantar protokol kepada penyelia", { "title": "Kemaskini Gantt", "due": "2026-11-10" } ] }
  ],
  "literature": [
    { "ref": "lit-mosca-2018", "title": "Cybersecurity in an era with quantum computers: will we be ready?", "authors": "Mosca", "year": "2018",
      "status": "include", "stars": 4, "tags": ["Teori"], "url": "https://doi.org/…", "notes": "" }
  ]
}
```

Rules
- Every section is optional. Dates are `YYYY-MM-DD`; time is `HH:MM`.
- `status` (tasks): `todo | doing | waiting | done`. `status` (literature): `include | maybe | exclude | ""`.
- `color`: `lav | sage | amber | rose | slate | grey`. `stars`: 0–5 (5 = must-read).
- `ref` is a stable id chosen by Claude. Importing the same `ref` again updates the item
  instead of duplicating it. Without `ref`, items match on title (plus date for meetings/milestones).
- On update, Lynn's own task status, milestone done flag, and literature status/stars/tags/notes are kept.
- Meeting `actions` become tasks linked to that meeting (tag "Penyelia").
