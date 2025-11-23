# drawdb Collab Server (Lightweight)

This is a minimal WebSocket server to enable live collaboration for drawDB. It:
- Opens a room per `shareId`
- Broadcasts diagram operations (`doc:replace`) to all participants
- Tracks presence/heartbeats
- Optionally persists the latest diagram back to the existing drawdb-server gist API

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

## Message contract

- Client → server:
  - `hello`: `{ type: "hello", shareId, clientId, mode }`
  - `heartbeat`: `{ type: "heartbeat" }`
  - `op`: `{ type: "op", op: { kind: "doc:replace", diagram } }`

- Server → client:
  - `op`: `{ type: "op", clientId, op }` (echoed to all room participants)
  - `presence`: `{ type: "presence", participants: Record<clientId, { lastSeen, mode }> }`
  - `error`: `{ type: "error", error }`
