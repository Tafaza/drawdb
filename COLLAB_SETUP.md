# Live Collaboration (Scaffold)

This codebase now includes frontend scaffolding for live collaboration. It stays dormant until a WebSocket backend is available.

## Configure

- Add `VITE_COLLAB_WS_URL` to your `.env.local`, pointing to the collaboration WebSocket endpoint (e.g., `wss://your-host/collab`).
- Collaboration only activates when a diagram has a `shareId` (e.g., you opened the app with `?shareId=<gistId>` or created one via the Share modal).
- Optional: add `mode=view` to the URL to force read-only viewing (`?shareId=abc123&mode=view`).
- To run the included dev server locally, from the repo root:
  - `cd server && npm install && npm start` (listens on `ws://localhost:4000` by default via `COLLAB_PORT`).
  - Set `VITE_COLLAB_WS_URL=ws://localhost:4000` in `.env.local` before `npm run dev` for the frontend.
  - Persistence (optional, recommended): set `PERSIST_BASE_URL=http://localhost:3001` (your drawdb-server endpoint) so the collab server flushes the latest diagram back to the gist on interval/threshold.

## Frontend Behavior

- A new `CollabProvider` opens a WebSocket per `shareId`, handles reconnect/heartbeat, and exposes state via `useCollab()`.
- Minimal UI indicator (`CollabStatus`) appears in the editor header showing connection state and participant count.
- `CollabEmitter` now debounces local changes and emits `doc:replace` operations (full diagram payload). The client ignores its own echoes and applies remote `doc:replace` payloads via the existing setters.

## Extending

- Implement server messages for:
  - `presence`: `{ type: "presence", participants: Record<clientId, Presence> }`
  - `op`: `{ type: "op", clientId, op: CollabOperation }` where `CollabOperation` supports `kind: "doc:replace"` with `{ diagram }` matching the current diagram shape.
  - `error`: `{ type: "error", error: string }`
- Use `sendOp(op)` from `useCollab()` to publish diagram changes; server should echo to all participants (including sender) with `clientId`.
- Locking and merge logic should be enforced server-side, with the client applying accepted ops through the existing React context setters.
