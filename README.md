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
