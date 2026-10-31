# Eigengrau

Pengurus PhD peribadi (PWA) · Personal PhD manager (PWA)

- Papan utama, garis masa, tugasan, log mesyuarat penyelia, penjejak literatur (Zotero)
- BM / English, saiz teks boleh laras
- Offline, data disimpan dalam peranti sahaja, disulitkan AES-256-GCM (kunci dari kata laluan, PBKDF2 600k)
- Kunci pemulihan, PIN, auto-kunci
- Sync antara peranti melalui fail bersulit (cth. dalam OneDrive)

No build step: plain HTML/CSS/JS modules. Serve the folder over HTTPS (e.g. GitHub Pages).
Bump `VERSION` in `sw.js` on every release so devices pick up the update.
