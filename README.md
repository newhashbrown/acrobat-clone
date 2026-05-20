# Acrobat Clone

A local-first, open-source PDF viewer and editor for Windows / macOS / Linux. Built with Electron, React, and TypeScript. Reads and writes PDFs entirely on your machine — no cloud, no telemetry, no account.

> Status: experimental. Useful for everyday viewing, signing, redacting, merging/splitting, OCR, comparing, sanitizing, and reorganizing PDFs. Editing existing PDF text and full-strength true-redaction are explicit non-goals for now (see [Limitations](#limitations)).

## Install

Prebuilt installers for the latest tagged release live at **[github.com/newhashbrown/acrobat-clone/releases/latest](https://github.com/newhashbrown/acrobat-clone/releases/latest)**. If that page is empty, no release has been cut yet — [build from source](#or-build-from-source) for now.

### Windows

1. Download `Acrobat Clone-<version>-Setup.exe` from the releases page.
2. Run it. Windows SmartScreen will warn that the publisher is unverified — the binary isn't code-signed yet. Click **More info → Run anyway**.
3. The NSIS installer is non-silent: pick the install directory and whether to install for the current user or all users.

Launch from the Start menu, or directly from `%LOCALAPPDATA%\Programs\Acrobat Clone\Acrobat Clone.exe` for per-user installs.

### macOS

1. Download the `.dmg` matching your architecture:
   - Apple Silicon (M1 and later): `Acrobat Clone-<version>-arm64.dmg`
   - Intel: `Acrobat Clone-<version>-x64.dmg`
2. Open the DMG and drag the app to `/Applications`.
3. First launch: Gatekeeper will block the unsigned/unnotarized binary. Right-click the app in Finder → **Open** → confirm. After the first launch, regular double-click works.

Code signing and notarization are on the roadmap.

### Linux

1. Download `Acrobat Clone-<version>-x64.AppImage`.
2. Make it executable:
   ```sh
   chmod +x "Acrobat Clone-<version>-x64.AppImage"
   ```
3. Run it:
   ```sh
   ./"Acrobat Clone-<version>-x64.AppImage"
   ```

The AppImage is fully portable — no system install step. To integrate with your application menu, either use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or move the file somewhere stable and create a `.desktop` entry by hand.

### Or build from source

See [Develop](#develop) and [Build](#build) below. Five-minute setup on Windows, macOS, or Linux given a recent Node 20 toolchain.

## Features

### Viewing
- Open local PDFs, drag-and-drop, recent-files list
- Page rendering via [PDF.js](https://github.com/mozilla/pdf.js) with HiDPI canvas
- Zoom (25–600 %), fit-width, fit-page
- Single-page, two-up, and continuous layouts
- Synchronized thumbnail sidebar with scroll-driven page tracking
- Text selection and copy
- In-document search with match jumping
- Document metadata panel (title, author, subject, dates, file size)
- Native print preview via Chromium's print dialog
- Keyboard navigation: arrows, PgUp / PgDn, Home / End

### Signing (Tier 1)
- Three signature methods in a single dialog: **Draw** (signature pad), **Type** (cursive font), **Upload Image** (PNG / JPG)
- Drag-to-place on any page with crosshair cursor; centered on click
- Aspect-locked resize, drag-to-move, click-to-delete
- Multi-signature support across pages
- Save Copy stamps the signatures into the output PDF via [pdf-lib](https://pdf-lib.js.org/)

### Redaction
- Drag a rectangle over any image / area
- Drag through **actual text** — each selected word becomes its own redaction box
- **Find & redact** — type a phrase, every match across the document gets marked
- **Pattern presets** — built-in regex for Social Security numbers, email, phone, credit card, IPv4, date
- Per-mark delete, Clear all, Esc to exit
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z) — batches like text-selection and find-and-redact undo as a single step
- Save Copy stamps solid black rectangles into the output PDF

### OCR
- Local Tesseract.js — runs entirely in-browser via WASM, no cloud
- 12 languages: English, French, Spanish, German, Portuguese, Italian, Dutch, Russian, Japanese, Chinese Simplified, Korean, Arabic
- Scope: current page / all pages / custom range
- Live progress bar with cancellation
- Recognized text shown in a side panel with copy buttons
- Save Copy embeds an **invisible searchable text layer** via pdf-lib operators — the resulting PDF is selectable and searchable in Acrobat, Preview, Chrome, anywhere
- First run downloads the language model (~12 MB) and caches it in IndexedDB; subsequent runs are fully offline

### Page Organization
- Dedicated full-screen Organize mode (Ctrl+Shift+E)
- Multi-select with click / Ctrl-click / Shift-click range
- Operations: delete, rotate L / R / 180°, duplicate, extract to new PDF, insert pages from another PDF, replace selected with another PDF
- Drag-and-drop reorder, including multi-select drag with insertion indicators
- Staged-and-save — nothing touches the original until you click Apply

### Compare
- Side-by-side view of two PDFs at the same page number, locked zoom and page nav
- Per-page word-level text diff in a side panel
- Summary counts: added / removed / unchanged
- Filter to show only changed pages or all pages
- Click a page row in the diff panel to jump both views

### Combine / Split
- **Combine PDFs**: multi-select, reorder, page-count preview, output to one PDF
- **Split PDF**: custom ranges (`1-3, 5, 7-9`) or every-N-pages chunks; folder picker for batched output

### Sanitize
- Pre-scan inspector counts everything before you commit
- Remove document metadata (Title / Author / Subject / Keywords / Creator / Producer / dates / XMP packet)
- Remove embedded JavaScript and document-level actions (`/JavaScript`, `/OpenAction`, `/AA`)
- Remove annotations / comments per page
- Flatten and remove form fields
- Remove file attachments
- Remove bookmarks / outline
- Audit summary after save

### Undo / Redo
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
- Tracks redactions and signatures
- Batched operations undo as a single step
- Browser-native text-input undo still works inside fields

## Tech stack

- **[Electron 33](https://www.electronjs.org/)** — desktop shell
- **[React 18](https://react.dev/)** + **TypeScript 5.7**
- **[Vite 5](https://vitejs.dev/)** via **[electron-vite](https://electron-vite.org/)** — main / preload / renderer dev pipeline with HMR
- **[PDF.js](https://github.com/mozilla/pdf.js)** — page rendering, text extraction, search
- **[pdf-lib](https://pdf-lib.js.org/)** — page manipulation, stamping, metadata editing
- **[Tesseract.js](https://tesseract.projectnaptha.com/)** — local OCR
- **[Zustand](https://github.com/pmndrs/zustand)** — renderer state
- **[signature_pad](https://github.com/szimek/signature_pad)** — signature drawing
- **[diff](https://github.com/kpdecker/jsdiff)** — text comparison
- **[electron-store](https://github.com/sindresorhus/electron-store)** — recent files + window bounds
- **[electron-builder](https://www.electron.build/)** — Windows / macOS / Linux installers
- **[lucide-react](https://lucide.dev/)** — icons

All dependencies are MIT or Apache-2.0 — fully compatible with the project's MIT license.

## Develop

```sh
npm install
npm run dev
```

`npm install` runs a postinstall script that copies the PDF.js worker and Tesseract.js worker / WASM cores into `src/renderer/public/` so they can be served same-origin in both dev and packaged builds.

`npm run dev` launches Electron with hot-module-reload on the renderer, watch-rebuild on main + preload, and DevTools auto-opened.

## Build

```sh
npm run typecheck   # strict TS on main, preload, renderer
npm run build       # bundle into ./out
npm run build:dir   # unpacked Windows build into ./release (fast smoke test)
npm run build:win   # NSIS installer .exe into ./release
```

For macOS / Linux installers, see [electron-builder.yml](./electron-builder.yml) — the targets are configured, you just need to run on the matching OS.

## Project layout

```
src/
├── main/index.ts              Electron main process — windows, menus, native dialogs, IPC, electron-store
├── preload/index.ts           Typed window.akv bridge exposed via contextBridge
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx            UI shell, IPC wiring, keyboard, mode routing
        ├── store.ts           Zustand store + undo/redo
        ├── pdf.ts             PDF.js bootstrap + worker URL
        ├── sign.ts            pdf-lib stamping (signatures, redactions, OCR layer)
        ├── ocr.ts             Tesseract.js wrapper with cancellation
        ├── diff.ts            Word-level page diff
        ├── sanitize.ts        Pre-scan + sanitize via pdf-lib catalog manipulation
        ├── organize.ts        Page-edit plan + applyPlan via pdf-lib copyPages
        ├── redact-find.ts     Substring and regex matching with bbox computation
        ├── styles.css
        └── components/
            ├── Toolbar.tsx
            ├── Thumbnails.tsx
            ├── PageRenderer.tsx          PDF page canvas + text layer + sig/redaction overlays
            ├── SidePanel.tsx             Metadata / Search / OCR / Diff panels
            ├── SignatureModal.tsx
            ├── MergeModal.tsx
            ├── SplitModal.tsx
            ├── OcrModal.tsx
            ├── CompareModal.tsx
            ├── DiffPanel.tsx
            ├── SanitizeModal.tsx
            └── OrganizeMode.tsx          Full-screen page-grid editor
```

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open | Ctrl+O |
| Save Copy | Ctrl+S |
| Print | Ctrl+P |
| Find | Ctrl+F |
| Zoom in / out / 100 % | Ctrl+= / Ctrl+- / Ctrl+0 |
| Sign | Ctrl+Shift+S |
| Redact | Ctrl+Shift+R |
| Combine PDFs | Ctrl+Shift+M |
| Split PDF | Ctrl+Shift+T |
| OCR | Ctrl+Shift+O |
| Compare | Ctrl+Shift+D |
| Sanitize | Ctrl+Shift+X |
| Organize Pages | Ctrl+Shift+E |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |

## Limitations

These are intentional v1 scope choices, not bugs.

- **Redaction is visual only.** Drawing black rectangles hides content on screen and in print, but the underlying text remains in the PDF content stream and can be recovered. True redaction (rewriting content streams or rasterizing pages) is a Tier 2 feature.
- **OCR text layer uses Helvetica encoding.** Non-Latin scripts (Chinese, Japanese, Arabic, etc.) OCR correctly and show in the side panel, but characters that Helvetica cannot encode are dropped from the embedded searchable text layer. A Unicode-font Tier 2 follow-up would fix this.
- **Editing existing PDF text is not supported.** Adobe Pro has decades of work in this area and reliable text editing on arbitrary PDFs is genuinely hard. Out of scope for now.
- **Document signing is Tier 1.** Drawn / typed / uploaded image — not cryptographically valid. PKCS#7 / CMS digital signing with timestamp servers is a Tier 2 feature.
- **Compare is text-only.** Same text in different positions reports as unchanged. Visual / pixel overlay diff is a planned follow-up.
- **Sanitize doesn't yet remove hidden text, hidden layers, or cropped content.** Those require content-stream surgery in pdf-lib that the library doesn't expose easily.
- **Organize Pages doesn't have undo within the mode.** It uses stage-and-save semantics — exit cancels the whole plan. A finer-grained history would help for very large reorganizations.

## Roadmap

Concrete next steps that have been scoped but deferred:

- True redaction (content-stream rewriting or rasterized page replacement)
- Page-picker sub-modal for Organize → Insert / Replace (currently uses all pages of the source)
- Visual / pixel overlay diff for Compare
- PKCS#7 digital signing (Tier 2)
- Unicode-font OCR layer
- Sanitize: hidden text / OCG layers / cropped content
- Export comparison report (PDF or HTML)
- Bundle Tesseract language data offline at install time

## License

[MIT](./LICENSE) © Gagan Singh
