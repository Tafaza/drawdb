# Stale Share Overwrite (Collab Persistence)

This note describes an issue where a stale or empty diagram can overwrite a newer shared version when using the collab persistence path.

## What happens
- On client startup, the collab emitter begins sending `doc:replace` ops on a 500ms interval as soon as the WebSocket is open, without waiting for the initial gist/share load to finish (`Workspace.jsx` → `CollabEmitter`).
- If the client’s in-memory state is old (or empty) and it sends first, the collab server accepts that snapshot, marks the room dirty, and later persists it to the share backend (gist) once thresholds/intervals are met or the last client disconnects (`server/index.js`).
- Result: opening a share link while nobody else is connected can push a stale snapshot that overwrites the newer gist, even though the user never intended to save.

## Why it happens
1) **No load gate on the emitter**: The client broadcasts before it knows it has the freshest diagram. The load from gist (`load()` in `Workspace.jsx`) is asynchronous and independent of collab connect.
2) **Server trusts first writer**: The collab server keeps the first non-no-op diagram it receives for the room and later persists it. There is no version/hash or recency check against the gist.
3) **Persistence triggers on disconnect/interval**: Even a short-lived session (open tab → WS connects → stale doc sent → tab closed) can cause the room to flush that stale doc to the gist when the room empties.

## Reproduction (single user)
1) Ensure collab server runs with `PERSIST_*` enabled and a share gist already has newer content.
2) Throttle/fail gist fetch (slow network or block the share API).
3) Open the shared link in edit mode; before the gist finishes loading, close the tab or drop the WS connection.
4) The collab server will persist the stale/empty snapshot it received first, overwriting the newer gist content.

## Impact
- Newer share revisions can be overwritten by stale local state when the first connecting client has not yet loaded the gist.
- Happens even without concurrent editors; occurs during slow/failing loads or quick open/close sessions.

## Mitigations (recommended)
- **Client-side gate**: Do not start `CollabEmitter` until the initial share load completes and the in-memory state reflects the fetched gist. Consider an explicit “loadedFreshDiagram” flag.
- **Server-side guard**: Optionally hydrate from the gist on first connection and/or require a version/hash/updated-at token in `doc:replace` before persisting. Reject or ignore stale snapshots.
- **Safety buffer**: Delay persistence until at least one fresh pull from the share backend succeeds, or require a minimum uptime before flushing when only one client was connected.

## Mitigation implemented
- The client now blocks `CollabEmitter` until the initial load finishes and marks sync-ready, preventing pre-load snapshots from being broadcast or persisted.
- Sync is also enabled as soon as a `doc:replace` arrives from the collab server (e.g., the server echoes the authoritative doc), ensuring we only start sending after we’ve seen a fresh source.
- If the share load fails and no server document arrives, collab sync stays disabled instead of pushing stale data.
