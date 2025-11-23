# Collaborative Diagrams Brief

Context for adding multi-user, live-ish diagram sharing (≤10 concurrent users, share-by-link, optimistic live updates with optional locking fallback).

## Current App Architecture
- Frontend-only Vite + React 18 SPA (`src/main.jsx` → `src/App.jsx`). State managed via React context providers under `src/context/` (diagram, layout, undo/redo, settings, etc.).
- Persistence: IndexedDB via Dexie (`src/data/db.js`). `db.diagrams` holds saved diagrams; `db.templates` holds templates. Autosave is driven in `src/components/Workspace.jsx` using `saveState`/`State` enum.
- Data model: tables (`id`, name, fields, indices, color, locked flag), relationships, notes, subject areas, tasks, types/enums per database type, transform (pan/zoom), and metadata (`database`, `title`). IDs are `nanoid`.
- UI surface: main editor in `src/components/Workspace.jsx` (provides `IdContext`), canvas under `src/components/EditorCanvas/`, controls in `src/components/EditorHeader/`.

## Existing Sharing/Versioning
- Optional backend: `VITE_BACKEND_URL` pointing to drawdb-server gist API (see `src/api/gists.js`). Files stored as `{filename: content}` JSON blobs.
- Share link modal (`src/components/EditorHeader/Modal/Share.jsx`): serializes the current diagram to JSON and writes `share.json` to a gist; link is `?shareId=<gistId>`. No real-time syncing; only pushes when modal opens. Unshare patches the file to `undefined`.
- Loading shared diagrams: `Workspace` checks `shareId` query param, fetches `share.json`, loads into state, and remembers `loadedFromGistId` for local persistence. No read-only guard unless viewing a specific version.
- Version history side sheet (`src/components/EditorHeader/SideSheet/Versions.jsx`): writes `versionned.json` snapshots to the same gist; provides read-only view when a historical version is loaded. Uses simple pagination via `/file-versions/:file`.

## Collaboration Gaps to Address
- No presence, conflict detection, or live updates. Autosave only writes to IndexedDB; share saves are manual via modal. Undo/redo is local only.
- Loading a `shareId` does not resync if the source gist changes; no polling or WebSocket layer.
- Diagram objects already carry `locked` on tables, but no enforcement or ownership tracking; could be used for “soft locks”.
- IndexedDB save/load logic assumes single-user; would need merge/patch strategy for remote edits.

## Constraints & Considerations
- Target concurrency is small (≈10). Latency tolerance allows live push/pull or coarse locks.
- Keep offline capability if possible: local edits should queue and reconcile when back online.
- Backend expectation: today only gist-like REST endpoints exist. For live collab, need either:
  1) Real-time channel (WebSocket/WebRTC/Ably/Supabase Realtime/Pusher); or
  2) Polling/long-poll with ETags + per-entity diff/merge; or
  3) Server-issued locks with TTL to gate writes.
- Security: links are guessable by gistId; there is no auth. Any link holder can read/write. Decide if we need signed tokens or limited role (owner vs viewer).

## Likely Integration Points
- Shared diagram serialization: reuse `diagramToString` structure from share/version components.
- Entry points for sync hooks: `Workspace` effects that watch `tables/relationships/...` and `saveState` are natural spots to emit changes; ingesting remote changes should go through the setters in `DiagramContext`, `AreasContext`, `NotesContext`, etc., to preserve undo/redo semantics.
- Read-only/lock UX: `layout.readOnly` already exists; can reuse for remote-view-only or when another user holds a lock. Table-level `locked` flags can visually disable interactions.
- Presence/awareness UI would likely live near `ControlPanel` or `EditorHeader`, and highlights/avatars could be layered in `Canvas`.

## Open Decisions for GPT-5
- Choose protocol: WebSocket vs polling; CRDT/OT vs last-write-wins + locks; message schema and room model (`shareId` as room key).
- Locking model: global doc lock vs table-level locks; TTL/heartbeat cadence; recovery after client drop.
- Conflict handling: merge strategy for tables/fields/types/enums/notes; how undo/redo interacts with remote patches.
- Persistence flow: when to write back to gist/API (on timer, on change batches, on manual save) and how to debounce.
- Auth/linking: whether to introduce user identity (anonymous IDs vs accounts) and how to surface edit/view roles.***
