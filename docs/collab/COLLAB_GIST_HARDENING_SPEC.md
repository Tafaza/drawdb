# COLLAB + GIST HARDENING SPEC

## Purpose

This document defines the required changes to harden the existing
**gist-backed live collaboration** implementation in drawdb.

Target use case:
- Small number of concurrent users
- Live collaboration via WebSocket
- Persistence backed by GitHub Gists
- High safety against data loss
- Clear separation between **edit** and **view** modes

This spec is intended to be consumed by an **agentic coding tool**
(e.g. Codex CLI) and should be implemented directly in the codebase.

---

## High-level Decisions

1. **Single-editor model**
   - Only one client may edit at a time.
   - Other clients are forced into view mode.
   - Enforcement is **server-authoritative**, not UI-based.

2. **doc:replace snapshot model is preserved**
   - No CRDTs or granular ops.
   - Safety is achieved via editor locking and snapshot replacement.

3. **Viewport-only state is excluded**
   - `transform` (pan/zoom) is local-only and must never affect collaboration or persistence.

4. **Explicit persistence**
   - Periodic persistence remains.
   - A new explicit “Save to gist” operation is required.
   - No gist revision must be created if nothing changed.

---

## Files in Scope

Backend:
- `server/index.js`

Frontend:
- `src/context/CollabContext.jsx`
- `src/collab/client.js`
- `src/components/Workspace.jsx`
- `src/components/EditorHeader/Modal/Share.jsx`

Reference docs:
- `COLLAB_GIST_EXPORT.md`

---

## Protocol Changes (WebSocket)

### New Client → Server Messages

- `persist_now`
  - Request immediate persistence to gist.

- `request_edit`
  - Request editor lock.

- `release_edit`
  - Release editor lock voluntarily.

### New Server → Client Messages

- `mode`
  ```json
  {
    "type": "mode",
    "mode": "edit" | "view",
    "reason": "locked" | "granted" | "released" | "expired",
    "editorClientId": "optional"
  }
persisted

json
Copia codice
{
  "type": "persisted",
  "lastFlushed": <timestamp>,
  "revision": "<gist revision or sha>",
  "updatedAt": "<iso timestamp>",
  "persistedVersion": <number>,
  "noChanges": <boolean>
}
persist_error

json
Copia codice
{
  "type": "persist_error",
  "message": "<error description>"
}
Server Requirements (server/index.js)
Room State Extensions
Each room must track:

js
Copia codice
{
  editorClientId: string | null,
  editorSince: number,
  editorTtlMs: number,        // e.g. 30000
  emptySince: number | null,  // for room grace period
  lastPersistedVersion: number
}
Edit / View Enforcement
On hello:

If requested mode is edit:

Grant only if no editor exists.

Otherwise force view and send mode message.

Store effective mode in socket.meta.effectiveMode.

On request_edit:

Grant only if no active editor or editor TTL expired.

Otherwise deny and force view.

On release_edit:

If sender is editor, release lock.

On op:

Reject unless:

socket.meta.effectiveMode === "edit"

socket.meta.clientId === room.editorClientId

Rejected ops must not mutate room state or be broadcast.

Presence messages must reflect effective mode, not requested mode.

Editor TTL
Editor heartbeat refreshes TTL.

If editor disconnects or TTL expires:

Release editor lock automatically.

Persistence & Data Safety
Room Grace Period (Refresh Safety)
When last client disconnects:

Do not delete room immediately.

Set room.emptySince = now.

Attempt persistence if dirty.

Periodic cleanup:

If room has no clients AND
now - emptySince > ROOM_IDLE_TTL_MS (e.g. 60s):

Final persist if dirty.

Delete room.

Persistence Correctness
Track room version.

When persisting:

Capture version being persisted.

Only clear dirty if room version has not changed during persist.

If no changes:

Do not PATCH gist.

Emit persisted { noChanges: true }.

Explicit Save
Implement persist_now:

Forces immediate persistence attempt.

Returns persisted or persist_error.

Persisted Metadata Sync
After successful persistence:

Emit persisted message to all clients.

Include:

lastFlushed

revision

updatedAt

If PATCH response does not contain revision info:

Perform a single GET on /gists/:id

Extract best available revision and timestamp.

Frontend must stop polling gist metadata and rely on this event.

Frontend Requirements
Collab Context (CollabContext.jsx)
Track:

requestedMode

effectiveMode (authoritative, server-driven)

Expose:

persistNow()

requestEdit()

releaseEdit()

persistStatus, persistError

Update effective mode on type=mode messages.

Workspace (Workspace.jsx)
Snapshot Rules
Collab snapshots must exclude transform.

transform remains local-only.

Emission Guards (MANDATORY)
CollabEmitter must NOT emit when:

effectiveMode !== "edit"

layout.readOnly === true (e.g. Versions view)

connection is not open

canSync === false

This prevents accidental overwrites when viewing historical versions.

Metadata Sync
Remove or disable periodic gist polling.

Update last-saved / revision UI from persisted WS messages.

Client WS Queue (src/collab/client.js)
Replace FIFO queue behavior for doc:replace:

Keep only the latest snapshot when offline.

New snapshots overwrite older pending ones.

Other message types may use a small FIFO if needed.

Share Modal (Modal/Share.jsx)
On open:

GET gist.

Compare existing share.json with intended content.

PATCH only if content differs (avoid useless revisions).

Provide two links:

View link: ...?shareId=<id>&mode=view

Edit link: ...?shareId=<id>&mode=edit

Save to Gist UI
Add a “Save to gist” action when collaboration is enabled.

Action must call persistNow().

Disable when:

Not connected

Effective mode is not edit

Acceptance Criteria
Only one editor at a time; enforced server-side.

Refreshing the editor page does not lose unsaved work.

Closing all clients persists data safely.

Opening Share modal does not create new gist revisions unless content changed.

“Save to gist” creates a revision only if data changed.

All clients receive synchronized revision + last-saved metadata.

transform never causes collaboration or persistence updates.

Viewing a historical version never emits collaboration updates.

Non-goals
No CRDTs

No granular ops

No support for hundreds of concurrent editors

No new major dependencies
