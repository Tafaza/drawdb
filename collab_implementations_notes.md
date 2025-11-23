[![drawDB | Online database diagram editor and SQL generator](https://tse1.mm.bing.net/th/id/OIP.H9KmgnbwlIJthnTOfrVKDwHaDf?pid=Api)](https://drawdb.xinso.dev/?utm_source=chatgpt.com)

Gotcha — we’re talking specifically about **drawdb-io/drawdb**. 👍

I’ll tailor everything to that repo and to the collab brief you attached.

---

## 1. Where drawDB is today (relevant bits)

From the repo + docs:

* **Frontend**: Vite + React SPA, all state in React contexts under `src/context/*`. ([GitHub][1])
* **Local persistence**: Diagrams live in **IndexedDB** via Dexie; autosave is wired in `Workspace.jsx` through a save state machine. ([drawdb-io.github.io][2])
* **Sharing right now**:

  * Clicking **Share** creates a **secret GitHub Gist** with the diagram JSON and gives you a `?shareId=<gistId>` URL. ([drawdb-io.github.io][3])
  * That URL **loads a copy**, not a live, collaborative document; there’s no resync if the gist changes and no presence or conflict handling. ([drawdb-io.github.io][3])
* **Backend**: Optional `drawdb-server` (Node/TS) that talks to GitHub’s REST API (gists + email), enabled by `.env.sample` in the main app and `.env.sample` in the server. ([GitHub][4])

Your **collaboration brief** already matches this structure very closely (contexts, `Workspace` as hub, Dexie tables, `locked` flags on tables, `layout.readOnly`, gist-based share/versioning), so I’ll build on that. 

---

## 2. Concrete decisions for *this* repo

### 2.1 Protocol & “room” model

**Decision:**
Use a **WebSocket channel per `shareId`** (room) on `drawdb-server`, with GitHub Gist still used for durable storage and version history.

* **Room key**: `shareId` (the gist ID you already use in links). All clients that open `?shareId=abc123` join the same room.
* **Message style**: **operation-based**, not “send whole document”.

  * `op: 'upsert-table' | 'delete-table' | 'update-relationship' | 'update-note' | ...`
  * Payloads carry `entityId`, minimal changed fields, and metadata: `{ clientId, opId, baseVersion, ts }`.
* **Server responsibilities (new)**:

  * Maintain in-memory `{ diagramState, version, locks, clients }` per `shareId`.
  * Broadcast each accepted op to all clients in the room.
  * Periodically flush the latest `diagramState` to the gist (see 2.4).

Why WebSockets over just polling?

* You already have a backend (`drawdb-server`) and a GitHub token wired in. ([GitHub][4])
* Target concurrency is tiny (≤10), so a naïve WS impl is enough and gives presence + low-latency updates essentially “for free”.
* Polling is still possible as a **fallback** (e.g. for self-hosters that don’t want a WS-capable runtime), but I’d design first-class around WebSockets.

Integration in the app (high level):

* New **`CollabProvider`** under `src/context/CollabContext.jsx` that:

  * Opens a WS connection when `Workspace` detects a `shareId`.
  * Exposes `connectionState`, `clientId`, `presence`, and helpers like `broadcastOp`.
* `Workspace.jsx` wires existing diagram contexts into the collab layer:

  * On local changes (tables/relationships/etc.), compute diffs → emit structured ops.
  * On incoming ops from WS, call the existing setters (`setTables`, `setRelationships`, `setNotes`, …) so undo/redo and derived state continue to work as today. 

---

### 2.2 Locking model

**Decision:**
Use **soft, table-level locks** with a TTL + heartbeat, not a global document lock.

* Each table already has a `locked` flag — extend this to:

  ```ts
  type TableLock = {
    tableId: string;
    clientId: string;
    lockedAt: number;   // server time
    ttlMs: number;      // e.g. 30_000
  };
  ```
* **Protocol**:

  * `lock-table` / `unlock-table` ops sent over WS.
  * Server enforces: if a table is locked by `A`, ops from `B` that modify that table are rejected (or queued) while the lock is valid.
* **TTL + heartbeat**:

  * TTL ~30s; clients holding locks send `lock-heartbeat` every 10s.
  * If the server hasn’t seen a heartbeat by `lockedAt + ttlMs`, it frees the lock.
* **UX**:

  * Locked tables are visually dimmed + show “Locked by X”.
  * If user tries to edit a locked table:

    * Can either be blocked with a toast, *or*
    * Offered a “Request control” that sends a `lock-request` message; owner can choose to release.
* **Fallback**:

  * Global “diagram lock” exists only as a simple **“read-only mode”** flag — for when the server is in maintenance mode or owner wants view-only.

This matches the “optimistic live updates with optional locking fallback” you described: most operations just succeed; locks only matter when people collide. 

---

### 2.3 Conflict handling & undo/redo

**Decision:**
Use **per-diagram version numbers + last-write-wins per entity**, and keep **undo/redo local to each client**.

**Versioning:**

* Server tracks a monotonically increasing `docVersion` per `shareId`.
* Every op from client includes `baseVersion` (the version its local state was synced to).
* On server:

  * If `baseVersion === docVersion` → apply op and increment `docVersion`.
  * If `baseVersion < docVersion` → still try to apply, but:

    * For *non-destructive* changes (e.g. renaming a table, moving it on canvas), just apply with **LWW** on affected fields.
    * For *destructive* changes (e.g. editing a table that was deleted remotely), reject the op and send an error/generic “state diverged” notification so the client can resync.

**Per-entity merge idea (simple):**

* Store `updatedAt` and `updatedBy` on entities in the diagram model (`tables`, `relationships`, `notes`, etc.).
* When applying an op:

  * If entity still exists, overwrite changed fields and bump `updatedAt/updatedBy`.
  * If not, ignore the op and return a “failed op” ack to that client, so they can roll it out of their pending queue.

**Undo/redo:**

* Undo/redo stacks stay **client-local**:

  * A “local action” creates:

    * A forward op (what we broadcast).
    * An inverse op (for local undo).
  * Pressing Undo:

    * Apply the inverse *locally* via existing context reducers.
    * Also broadcast a **new** op representing the undone change (so other clients see the effect), not a magical “undo” instruction.

This way:

* You never try to “undo somebody else’s work.”
* Remote operations don’t spam your undo history, but you still see them in the canvas.

---

### 2.4 Persistence & syncing with gists + IndexedDB

**Decision:**
Treat the **WebSocket layer as the live source of truth**, and use **IndexedDB and GitHub Gists as persistence layers**:

1. **On the frontend (per user):**

   * Keep existing IndexedDB autosave exactly as-is, so single-player and offline keep working.
   * Additionally, keep a small Dexie table of **pending ops**:

     ```ts
     { opId, shareId, payload, status: 'pending' | 'acked' | 'failed' }
     ```
   * When WS is connected:

     * Flush any `pending` ops.
     * Mark ops as `acked` when server confirms.
   * When **offline**:

     * Still let the user edit; enqueue ops locally and keep saving the full diagram to IndexedDB.
     * On reconnect, reload latest server snapshot + replay unsynced ops (skipping those the server rejects).

2. **On the server (per `shareId`):**

   * Keep current diagram in memory as JSON (same shape as today’s `diagramToString` output). 
   * Flush policy for gist:

     * On explicit “Save version” (your existing version history UI) → write a snapshot file (e.g. `versionned.json`) to the gist.
     * Also flush `share.json`:

       * Every **N ops** (e.g. 50) or every **T seconds** (e.g. 30s) while there are active clients.
       * When the last client leaves a room.
   * On server restart:

     * Rehydrate `diagramState` for a room from `share.json` in the gist if present, otherwise from the first client that connects (using their full diagram as seed).

This keeps GitHub API usage modest, but still ensures that:

* Share links remain durable (gist holds the latest state).
* Local browser storage remains the offline fallback.

---

### 2.5 Auth, link model, and roles

**Decision:**
Short term, stick with **link-as-token, anonymous identities**; make “viewer” vs “editor” purely a property of the link.

* **Identity:**

  * Each client gets a random `clientId` (nanoid) stored in `localStorage`.
  * Optional: allow setting a display name in the header (stored locally, sent to others via `presence` messages).
* **Links & roles:**

  * Keep `?shareId=<gistId>` as the basic entry point.
  * Add optional parameters:

    * `?shareId=abc123&mode=view` → open in `layout.readOnly` and simply subscribe to WS updates (no write ops). 
    * `?shareId=abc123&mode=edit` → full editor.
  * No real security guarantee here beyond secrecy of the link — which matches current secret-gist security model and the docs warning that gists are visible if you have the URL. ([drawdb-io.github.io][3])
* **Future-ready:**

  * When/if you introduce accounts (GitHub/Email-based), you can:

    * Use the same WS protocol but add a JWT or session cookie.
    * Enforce stronger role checks server-side (owner vs collaborator vs viewer).

---

### 2.6 Presence & UX hooks

**Decision:**
Add a thin presence layer on top of WS and plug it into existing UI scaffolding.

* **Presence messages**:

  * `join`, `leave`, `heartbeat`, `cursor-move`, `selection-change`.
* **Client state:**

  * `CollabContext` maintains `participants: Record<clientId, { name, color, lastSeen, cursor, selection }>` and exposes it to:

    * Header (avatars + count).
    * Canvas (ghost selections, optional remote cursors).
* **Read-only integration:**

  * Reuse `layout.readOnly` to gate interactions when:

    * URL says `mode=view`, or
    * Server puts the doc into read-only (e.g., during migration or if owner enforces single-editor mode). 

---

### 2.7 Minimal impact on existing code paths

Everything above can be done without ripping up the current architecture:

* No need to change how diagrams are *represented* — all ops work on the same schema you’re already serializing to JSON and storing in Dexie/gists.
* `Workspace.jsx` stays the orchestrator:

  * It already knows whether it was loaded from a gist (`shareId`) and handles autosave and versioning, which is the perfect place to mount/unmount the `CollabProvider`.
* Existing “Share” and “Version history” UIs keep working, but can gain:

  * A **“Start live collaboration”** toggle (which just connects the WS layer).
  * Indicators like “3 people currently editing this diagram”.

---

If you tell me what you’d like next, I can jump straight into one of these:

* a concrete **TypeScript WS message schema** for `drawdb-server`,
* a **React-level API** for `CollabProvider` and wiring into `Workspace`, or
* a **migration plan** that keeps the old “share is just a copy” behavior alongside the new live-collab mode.

[1]: https://github.com/drawdb-io/drawdb?utm_source=chatgpt.com "GitHub - drawdb-io/drawdb: Free, simple, and intuitive online database ..."
[2]: https://drawdb-io.github.io/docs/how-it-works?utm_source=chatgpt.com "How it works | drawDB DOCS"
[3]: https://drawdb-io.github.io/docs/share?utm_source=chatgpt.com "Sharing a diagram | drawDB DOCS"
[4]: https://github.com/drawdb-io/drawdb-server?utm_source=chatgpt.com "GitHub - drawdb-io/drawdb-server: Simple server to handle form ..."
