# RYN THE JOURNAL

Personal trading journal & performance analytics — 100% lokal, tanpa server, tanpa login.

Ini adalah **web app (HTML/CSS/JS)**, bukan project Android native. Tujuannya supaya kamu bisa
langsung olah/kembangkan di GitHub, lalu (opsional) bungkus jadi APK menggunakan Capacitor
(lihat bagian "Build ke APK" di bawah).

---

## 1. Struktur Project

```
ryn-the-journal/
├── index.html          # shell utama: splash screen, nav, container halaman
├── manifest.json        # PWA manifest (biar bisa "Add to Home Screen")
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg     # ganti file ini untuk custom icon
├── css/
│   └── style.css        # dark trading-terminal theme, monospace, semua komponen UI
└── js/
    ├── db.js             # layer IndexedDB (local storage untuk trade, settings, image base64)
    ├── calc.js            # SEMUA rumus statistik (win rate, expectancy, PF, dsb) — sudah diuji
    ├── render.js          # fungsi render HTML untuk tiap halaman/komponen (pure functions)
    ├── app.js             # state management, event handling, CRUD, CSV/backup, navigasi
    └── ai-journal.js      # RYN AI AUTO JOURNAL — lihat bagian 10 di bawah
```

## 2. Teknologi yang digunakan

- **Vanilla HTML/CSS/JavaScript** — tanpa framework, tanpa build step, gampang di-fork/edit di GitHub.
- **IndexedDB** (native browser API) — database lokal, persisten setelah app ditutup/HP restart.
  Screenshot chart disimpan sebagai base64 di dalam record trade, sehingga tetap ada tanpa
  perlu izin filesystem tambahan.
- **Chart.js** (via CDN `cdn.jsdelivr.net`) — equity curve & monthly performance chart.
- **Google Fonts — JetBrains Mono** (via CDN) — typography monospace di seluruh app.
- Tidak ada backend, tidak ada API key, tidak ada tracking.

> Catatan: karena font & Chart.js diambil dari CDN, app butuh koneksi internet sekali di awal
> untuk cache font/script (browser modern akan cache otomatis). Untuk 100% offline, kamu bisa
> download `chart.umd.min.js` dan font woff2 lalu simpan lokal di project — tinggal ganti path
> `<link>`/`<script src>` di `index.html`.

## 3. Cara menjalankan (development)

Karena pakai `fetch`/IndexedDB, harus dibuka lewat local server (bukan `file://`):

```bash
cd ryn-the-journal
python3 -m http.server 8080
# lalu buka http://localhost:8080 di browser/HP (chrome di HP yang satu wifi dengan laptop)
```

Atau pakai extension "Live Server" di VS Code, atau `npx serve`.

## 4. Deploy cepat (tanpa APK dulu)

Push folder ini ke GitHub repo, aktifkan **GitHub Pages** (Settings → Pages → branch `main` /root).
Setelah live, buka URL-nya di HP → tap menu browser → **"Add to Home Screen"**. App akan
terpasang seperti app native (ikon sendiri, fullscreen, tanpa address bar) berkat `manifest.json`.
Data tetap tersimpan lokal di HP tersebut (IndexedDB per-browser, per-device).

## 5. Build jadi APK asli (Capacitor)

Setelah kamu selesai "olah" HTML-nya di GitHub, ini cara paling praktis untuk bungkus jadi `.apk`:

```bash
npm install -g @capacitor/cli
mkdir ryn-apk && cd ryn-apk
npm init -y
npm install @capacitor/core @capacitor/android
npx cap init "RYN THE JOURNAL" "com.ryn.journal" --web-dir=www

# copy semua isi ryn-the-journal/ ke folder www/
cp -r ../ryn-the-journal/* www/

npx cap add android
npx cap copy android
npx cap open android
# Android Studio akan terbuka -> Build > Build Bundle(s)/APK(s) > Build APK(s)
```

Lokasi hasil APK setelah build: `android/app/build/outputs/apk/debug/app-debug.apk`

### Ganti nama aplikasi
Edit `android/app/src/main/res/values/strings.xml` → ubah `app_name`.
Juga bisa diubah lewat `capacitor.config.json` (`appName`) sebelum `npx cap add android`.

### Ganti icon aplikasi
Ganti file di `android/app/src/main/res/mipmap-*/ic_launcher.png` (berbagai resolusi),
atau paling gampang pakai [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/)
untuk generate semua ukuran dari satu gambar, lalu drop ke folder `mipmap-*`.

## 6. Database Schema (IndexedDB)

**Object store `trades`** (keyPath: `id`):

| Field | Tipe | Keterangan |
|---|---|---|
| id | string | unique id |
| date | string (YYYY-MM-DD) | tanggal trade |
| days | string[] | multi-select MONDAY–FRIDAY |
| pairs | string[] | XAUUSD, NAS100, ... , CUSTOM |
| customPair | string | isi manual jika pairs berisi "CUSTOM" |
| sessions | string[] | ASIA/LONDON/NY AM/NY PM |
| direction | "BUY"\|"SELL" | |
| models | string[] | daftar confluence (FVG, OB, SMT, dst) |
| timeframes | string[] | H4, H1, M15, ... |
| rr | string | "1:2" dst, atau "CUSTOM" |
| customRR | string | isi manual jika rr = "CUSTOM" |
| risk | string | "1%" dst, atau "CUSTOM" |
| customRisk | string | isi manual jika risk = "CUSTOM" |
| result | "TP"\|"SL"\|"BE" | |
| timeEntry | string | contoh "10:10 - 10:25" |
| idealR | number (string) | opsional, untuk Could-Have-Profit/BE |
| note | string | catatan bebas |
| images | string[] (base64 data URL) | screenshot chart |

**Object store `settings`** (keyPath: `key`): currency, defaultRisk, defaultRR,
minSampleSize, darkMode.

## 7. Rumus yang dipakai (sudah divalidasi terhadap test case di spesifikasi)

- **R per trade**: `TP → +RR`, `SL → -1R`, `BE → 0R`
- **Win Rate** = win / total × 100
- **Expectancy** = (WinRate × AvgWinR) − (LossRate × AvgLossR), BE dihitung 0R
- **Profit Factor** = GrossWinR / |GrossLossR| (tampil "N/A" jika belum ada loss)
- **Max Consecutive Win/Loss** dihitung dari urutan trade berdasarkan tanggal
- **Equity Curve** = kumulatif R berurutan tanggal
- **Combination Analysis** mengelompokkan trade berdasarkan kombinasi persis
  (pair + session + direction + model), dengan minimum sample size yang bisa diubah (3/5/10/20/30)
- **Pattern Insights** murni deskriptif dari data ("Data menunjukkan..."), tidak pernah membuat
  klaim kalau data belum cukup (di bawah minimum sample)

Sudah diuji dengan test case resmi (3 trade RR 1:2 → TP, SL, TP) dan hasilnya sama persis:
Total R +3, Avg R +1, Expectancy +1R, PF 4.0, Equity [0, +2, +1, +3].

## 8. Fitur yang sudah diimplementasikan

- Splash screen fade in/out (±2 detik)
- Dark trading-terminal theme, monospace (JetBrains Mono)
- 5 halaman: Dashboard, Journal, Analytics, Pattern, Settings
- Add/Edit/Delete trade dengan multi-select (day, pair, session, model, timeframe)
- Upload multi-image, tersimpan lokal (base64 di IndexedDB), bisa dihapus
- Search & filter di Journal (result: TP/SL/BE)
- Dashboard lengkap (semua statistik di spesifikasi §6–§10)
- Equity curve chart, performance by month/year/session/model
- Combination analysis (top & worst, minimum sample size adjustable)
- Pattern insights halaman terpisah
- Export/Import CSV, Backup/Restore JSON, Hapus semua data
- **RYN AI AUTO JOURNAL**: input natural language / screenshot → review → confirm & save
  (lihat bagian §10), berjalan offline tanpa API key, siap disambungkan ke backend AI sungguhan
- Semua analytics otomatis recalculate saat trade ditambah/edit/hapus (karena dihitung
  langsung dari `state.trades` setiap render, tidak ada cache basi)

## 10. RYN AI AUTO JOURNAL

Tombol **✦ AI JOURNAL** di kanan atas membuka alur: tulis cerita trade (dan/atau lampirkan
screenshot) → ANALYZE → REVIEW BEFORE SAVE (semua field bisa diedit) → CONFIRM & SAVE →
trade masuk ke IndexedDB yang sama persis dengan Add Trade manual (`STORE_TRADES`).

**Arsitektur** (`js/ai-journal.js`, terpisah dari `app.js`):

- `AIJournalService.analyzeTrade(text, images)` — satu pintu abstraksi AI. Tidak ada API key
  yang di-hardcode di mana pun, karena ini static web app dan setiap key di client-side code
  otomatis terlihat oleh siapa pun yang buka DevTools.
- **Mode default (LOCAL MODE, offline, tanpa API key):** parser rule-based yang mengenali
  sinonim (gold→XAUUSD, nq/nasdaq→NAS100, buy/long→BUY, dst — persis daftar normalisasi di
  spesifikasi), mendeteksi session/model/timeframe dari kata kunci, meng-ekstrak angka entry/SL/TP,
  menghitung RR otomatis dari rumus BUY/SELL yang diminta, dan mendeteksi result (TP/SL/BE) tanpa
  pernah menebak angka yang tidak disebutkan. Sudah diuji langsung terhadap 2 contoh kalimat di
  spesifikasi dan hasilnya cocok (RR 1:2.00, model SMT+CISD+LIQUIDITY SWEEP, dst).
- **Mode remote (opsional, untuk AI sungguhan seperti Claude/GPT):** set sebelum `ai-journal.js`
  dimuat:
  ```html
  <script>
    window.RYN_AI_CONFIG = { endpoint: 'https://backend-kamu.example.com/analyze-trade' };
  </script>
  ```
  `AIJournalService` akan POST `{ text, images }` ke endpoint itu dan pakai JSON yang
  dikembalikan. **Endpoint ini wajib backend/serverless proxy milik kamu sendiri** (Cloudflare
  Worker, Vercel function, dst) yang menyimpan API key provider AI di server, bukan di JS ini.
  Tanpa `RYN_AI_CONFIG`, badge di modal menampilkan "AI SERVICE NOT CONFIGURED" dan otomatis
  jatuh ke local mode di atas — Add Trade manual tetap berjalan normal seperti biasa.
- Screenshot yang dilampirkan di-resize/kompres otomatis (max 1280px, JPEG ~72%) lewat canvas
  sebelum disimpan sebagai base64, memakai mekanisme image storage yang sama dengan Add Trade
  (tidak ada sistem penyimpanan gambar baru).
- Trade yang tersimpan dari AI Journal mendapat 3 field tambahan yang sifatnya aditif —
  `aiAnalysis` (ringkasan faktual, bukan opini), `aiConfidence` ('confident'/'needs_review'),
  `aiSource` ('local-heuristic'/'remote-api'). Trade lama yang tidak punya field ini tetap
  bekerja normal; Export CSV & Backup/Restore JSON sudah tahan terhadap field opsional ini.

## 9. Yang perlu kamu lanjutkan / sesuaikan sendiri di GitHub

- Filter global lintas halaman (saat ini filter ada di Journal & combination min-sample;
  kalau mau filter tanggal/pair dsb memengaruhi Dashboard & Analytics juga, tinggal reuse
  `getFilteredTrades()` di `app.js` untuk semua halaman, bukan cuma Journal)
- Custom app icon (ganti SVG di `icons/`)
- Opsional: pindahkan Chart.js & font ke lokal untuk full-offline tanpa CDN
- Splash screen bisa diberi logo/gambar tambahan sesuai selera
