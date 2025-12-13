# drawdb Collab Server (Lightweight)

This is a minimal WebSocket server to enable live collaboration for drawDB. It:
- Opens a room per `shareId`
- Broadcasts diagram operations (`doc:replace`) to all participants
- Tracks presence/heartbeats
- Optionally persists the latest diagram back to the existing drawdb-server gist API

> Important: this server runs separately from the main app. Its env vars are **normal Node env vars** (e.g. `PERSIST_BASE_URL=... npm start`), not `VITE_` variables.

## Run locally

```bash
cd server
npm install
COLLAB_PORT=4000 npm start
```

Frontend config (`.env.local` in the app root):
```
VITE_COLLAB_WS_URL=ws://localhost:4000
```

## Optional persistence to gist

If you want the live-collab state written back to the existing sharing backend (drawdb-server), set:
```
PERSIST_BASE_URL=http://localhost:3001   # where drawdb-server listens
PERSIST_FILENAME=share.json              # optional, defaults to share.json
PERSIST_FLUSH_MS=30000                   # optional, flush interval in ms
PERSIST_OPS_THRESHOLD=50                 # optional, flush after N ops
```

Requirements:
- drawdb-server running with a valid `GITHUB_TOKEN` (gist scope) so it can update the gist.
- `shareId` must correspond to the gist ID created via the Share flow.

Note that this persistence is **in addition to** the normal Share/Versions flows in the frontend, which talk to `VITE_BACKEND_URL` (drawdb-server) directly and write `share.json` / version files per user action.

## Modes overview

Depending on what you configure, you effectively get these modes:

- **Local-only (no collab, no gists)**  
  - Run `npm run dev` in the app with no `VITE_COLLAB_WS_URL` and no `VITE_BACKEND_URL`.  
  - Diagrams are stored only in the browser (Dexie); no WebSocket, no gists.

- **Share via gist, no live collab**  
  - App has `VITE_BACKEND_URL` pointing to drawdb-server.  
  - You use the Share/Versions UI, but do **not** run this collab server (or omit `VITE_COLLAB_WS_URL`).  
  - Gists are written only on explicit share/version actions.

- **Live collab, no gist persistence**  
  - Run this server with `COLLAB_PORT` (and **without** `PERSIST_BASE_URL`).  
  - App has `VITE_COLLAB_WS_URL` pointing at this server.  
  - State is shared live over WebSocket only; nothing is written to gists by this server.

- **Live collab + gist persistence**  
  - Same as above, but also set `PERSIST_BASE_URL` (and optionally `PERSIST_FILENAME`, `PERSIST_FLUSH_MS`, `PERSIST_OPS_THRESHOLD`).  
  - This server periodically PATCHes the gist through drawdb-server, in addition to the normal Share/Versions writes from the frontend.

## Message contract

- Client → server:
  - `hello`: `{ type: "hello", shareId, clientId, mode, clientName }`
  - `heartbeat`: `{ type: "heartbeat" }`
  - `set_client_name`: `{ type: "set_client_name", clientName }`
  - `op`: `{ type: "op", op: { kind: "doc:replace", diagram } }`
  - `request_edit`: `{ type: "request_edit" }` (try to acquire the single-editor lock)
  - `release_edit`: `{ type: "release_edit" }` (release the lock if you hold it)
  - `request_release`: `{ type: "request_release" }` (ask the current editor to release)
  - `dismiss_edit_request`: `{ type: "dismiss_edit_request", targetClientId }` (editor dismisses a request)
  - `force_edit`: `{ type: "force_edit" }` (steal the lock; requires `COLLAB_FORCE_EDIT_ENABLED=true`)

- Server → client:
  - `mode`: `{ type: "mode", mode: "edit" | "view", reason, editorClientId }`
  - `op`: `{ type: "op", clientId, op }` (echoed to all room participants)
  - `presence`: `{ type: "presence", participants: Record<clientId, { lastSeen, mode, name }> }`
  - `edit_request`: `{ type: "edit_request", fromClientId, at }` (sent to the current editor)
  - `edit_request_sent`: `{ type: "edit_request_sent", editorClientId }` (ack to requester)
  - `edit_request_dismissed`: `{ type: "edit_request_dismissed", targetClientId }` (ack to editor)
  - `edit_request_denied`: `{ type: "edit_request_denied", reason, editorClientId }` (sent to requester)
  - `error`: `{ type: "error", error }`
  - `force_edit_denied`: `{ type: "force_edit_denied", reason, editorClientId }`
