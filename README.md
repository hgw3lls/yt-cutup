# yt-cutup

`yt-cutup` is a TypeScript/Vite project for working with a curated YouTube search map called **TRANSMISSIONS**. It ships:

- A validated JSON dataset of transmission modules (`data/transmissions/*`).
- Runtime loaders and schema guards (Zod) for index + module integrity.
- UI building blocks for:
  - Browsing transmissions and queueing queries.
  - Building a broadcast assembly plan and exporting JSON.

This repository is designed so the same data can be validated in CI and loaded by a browser app.

---

## Table of Contents

- [What this project does](#what-this-project-does)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [How to run](#how-to-run)
- [Development workflow](#development-workflow)
- [Data model](#data-model)
- [How to add or edit transmissions](#how-to-add-or-edit-transmissions)
- [Broadcast plan export format](#broadcast-plan-export-format)
- [Validation and CI](#validation-and-ci)
- [Troubleshooting](#troubleshooting)

---

## What this project does

1. **Validates transmission metadata and modules** before build.
2. **Serves JSON data under `/data`** in local Vite dev and copies it into `dist/data` during build.
3. Provides UI modules that can be mounted in a host page/app:
   - `mountBrowsingUI(container)` for search/browse/query queue behavior.
   - `mountBroadcastAssemblyUI(container)` for drag-reorder + JSON plan export.

The repository now includes a runnable Vite entrypoint (`index.html` + `src/main.ts`) with three switchable views:

- Transmission Browser
- Broadcast Assembly
- Validation Report

---

## Repository layout

```txt
.
├── data/
│   ├── clips/
│   │   └── clips.manifest.schema.json
│   └── transmissions/
│       ├── transmissions.index.json
│       └── <TRANSMISSION_ID>.json
├── scripts/
│   └── validate-data.ts
├── index.html
├── src/
│   ├── main.ts
│   ├── lib/
│   │   ├── schema.ts
│   │   └── loaders.ts
│   └── ui/
│       ├── index.ts
│       ├── broadcast-assembly.ts
│       ├── validation-report.ts
│       ├── error-boundary.ts
│       └── components/
└── vite.config.ts
```

---

## Prerequisites

- **Node.js 22+** (matches CI config)
- **npm**

Check versions:

```bash
node -v
npm -v
```

---

## Install

```bash
npm install
```

---

## How to run

### Frontend only (Transmission Browser + Broadcast Assembly)

Use this when you only need the local Vite app and static `/data` files.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### Full app (frontend + FastAPI backend)

Use this when you need YouTube Search, Video Detail, OAuth playlist actions, or API-backed flows.

1. Install frontend dependencies:

   ```bash
   npm install
   ```

2. Set backend environment values (example):

   ```bash
   export YOUTUBE_API_KEY="..."
   export GOOGLE_CLIENT_ID="..."
   export GOOGLE_CLIENT_SECRET="..."
   export OAUTH_REDIRECT_URL="http://localhost:8787/api/auth/callback"
   export FRONTEND_ORIGIN="http://localhost:5173"
   ```

3. Install backend Python dependencies (first run):

   ```bash
   cd server
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```

4. Start both services:

   ```bash
   npm run dev:all
   ```

This starts:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

If you prefer separate terminals:

```bash
npm run dev:client
npm run dev:server
```

---

## Development workflow

### 1) Validate data only

```bash
npm run validate:data
```

This checks:

- `transmissions.index.json` schema.
- Every file listed in `transmissions[].file` exists.
- Transmission IDs match between index and module file.
- Category IDs in modules exist in `category_defs`.
- Category query arrays are non-empty.

### 2) Start Vite dev server

```bash
npm run dev
```

Open the app in your browser (default: `http://localhost:5173`). Use the top navigation to switch between:

- Transmission Browser
- Broadcast Assembly
- Validation Report

The custom Vite plugin maps local repository `data/` to browser path `/data/...` so UI loaders can request files like:

- `/data/transmissions/transmissions.index.json`
- `/data/transmissions/TT01.json`

### 3) Build production bundle

```bash
npm run build
```

Build behavior:

- Runs `npm run validate:data` first (`prebuild` script).
- Builds frontend assets with Vite.
- Copies repository `data/` to `dist/data/`.

---

## Data model

### `data/transmissions/transmissions.index.json`

Top-level required sections:

- `schema_version`
- `project`
- `defaults`
- `category_defs`
- `transmissions`
- `clip_selection`

### Transmission module file (`data/transmissions/<ID>.json`)

Each module contains:

- `transmission_id` (must match index entry)
- `title`
- `categories[]`
  - `category_id`
  - `queries[]` (must have at least one query)

### Clips manifest reference

`data/clips/clips.manifest.schema.json` documents expected selected-clip fields for downstream extraction/export workflows.

---

## How to add or edit transmissions

1. **Edit index**: add/update an entry in `data/transmissions/transmissions.index.json`:

   ```json
   {
     "transmission_id": "AB24",
     "title": "EXAMPLE TITLE",
     "file": "AB24.json"
   }
   ```

2. **Create module file**: add `data/transmissions/AB24.json` with all needed categories and non-empty query arrays.

3. **Ensure categories are valid**: every `category_id` used in the module must exist in `category_defs` from index.

4. **Run validation**:

   ```bash
   npm run validate:data
   ```

5. **Build-check before merge**:

   ```bash
   npm run build
   ```

---

## Broadcast plan export format

The broadcast assembly UI exports JSON shaped like:

```json
{
  "created_at": "2025-01-01T00:00:00.000Z",
  "runtime_target_minutes": 45,
  "sequence": [
    {
      "transmission_id": "TT01",
      "title": "TRANSMISSION TRESPASS",
      "active_beds": ["radio_broadcast"],
      "shutdown_event": false,
      "blocks": [
        { "type": "stinger", "duration_sec": 15, "source": "query:intro-group" },
        { "type": "spokenword", "duration_sec": 180, "source": "lyrics_reference_only" },
        { "type": "samplebed", "duration_sec": 90, "source": "clips" },
        { "type": "stinger", "duration_sec": 15, "source": "query:outro-group" }
      ]
    }
  ]
}
```

Rules applied by the current implementation:

- `spokenword` block is always included.
- `samplebed` block is included only when at least one active bed category is selected.
- Intro/outro `stinger` blocks are included only when their query group string is non-empty.

---

## Validation and CI

GitHub Actions (`.github/workflows/ci.yml`) runs:

1. `npm install`
2. `npm run validate:data`
3. `npm run build`

Any schema or consistency issue in transmission data fails CI.

---

## Troubleshooting

### `Unable to reach /data/...`

- Confirm dev server is running (`npm run dev`).
- Confirm requested file exists in `data/`.

### `Invalid transmissions index ...` or `Invalid transmission module ...`

- Fix the JSON structure to match schema expectations in `src/lib/schema.ts`.
- Re-run `npm run validate:data` to locate first failing field.

### Build succeeds but transmission data is missing at runtime

- Ensure `dist/data/transmissions` exists after build/deploy.
- Verify your host serves the `dist/data` folder as static assets.

---

## License

No license file is currently present in this repository.

---

## YouTube Search view (official API)

The app includes a **YouTube Search** tab that calls a lightweight FastAPI backend.
Selecting a search result now opens a **Video Detail** panel with an embedded YouTube player and a reusable multi-range timecode editor (with localStorage persistence keyed by `videoId`).

Frontend API base is configured with:

```bash
VITE_API_BASE=http://localhost:8787
```

If unset, it defaults to `http://localhost:8787`.

Backend is in [`server/`](server/) and requires `YOUTUBE_API_KEY`. See [`server/README.md`](server/README.md) for run steps.

### Clip Board + clips manifest export

The app includes a global **Clip Board** tab for timestamp annotations (no media download).

- Collect clips from YouTube Video Detail with **Add ranges to Clipboard**.
- Filter clips by title/channel/tags.
- Export:
  - `clips.manifest.json`
  - CSV (`clip_id,title,url,start,end,notes,tags`)

Manifest shape is validated by Zod (`src/lib/schema.ts`) and the JSON schema at `data/clips/clips.manifest.schema.json`.

---

## YouTube Search + Timestamping (annotation-only)

The frontend includes a **YouTube Search** flow for metadata + timestamp annotation only.

- Search videos from backend YouTube API endpoints.
- Open **Video Detail** with embedded YouTube player + current-time range helpers.
- Create timestamp ranges and notes/tags in the range editor.

This project does **not** download or extract media (`yt-dlp`/`ffmpeg` are intentionally excluded).

## Clip Board + Exports

Use the **Clip Board** tab to aggregate clip annotations across videos.

- Filter/search clips by title, channel, playlist title, and tags.
- Import a `clips.manifest.json` and validate against Zod schema.
- Bulk tag edit for filtered clips.
- Export:
  - `clips.manifest.json`
  - CSV

## Playlists import + two-way sync semantics

Use the **Playlists** tab for OAuth playlist workflows and local mirror staging.

- Load **My Playlists** (OAuth) or import playlist by URL/ID (public read).
- Clone imported/non-owned playlists into your account.
- Local mirror stages add/remove/reorder changes before push.
- Push is explicit (no silent overwrite): refresh remote, apply operations, then pull fresh.

### Reorder limitations + rebuild warning

Playlist reorder uses backend best-effort strategy:

1. Try `playlistItems.update` with snippet positions.
2. If needed, fallback to delete+reinsert rebuild (when enabled).

Rebuild fallback may temporarily remove/reinsert entries and is exposed in API warnings/progress.

## OAuth setup

Create `.env` from `.env.example` and fill required values:

- `VITE_API_BASE`
- `YOUTUBE_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_REDIRECT_URL`
- `FRONTEND_ORIGIN`

### Dev scripts

- `npm run dev:client` — Vite frontend
- `npm run dev:server` — FastAPI backend (`python -m uvicorn`)
- `npm run dev:all` — run both with `concurrently`
