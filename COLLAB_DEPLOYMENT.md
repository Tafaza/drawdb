# Collaboration Deployment & Next Steps

## Milestone status (current)
- Frontend supports live sync via WebSocket `doc:replace` ops, honors `mode=view`, shows connection status, and applies remote diagrams through existing setters.
- Collab WS server (`server/index.js`) supports rooms by `shareId`, presence heartbeats, broadcasts ops, and can persist the latest diagram back to the existing share backend (drawdb-server) using `PERSIST_BASE_URL`.
- Share backend (drawdb-server) handles gist storage via `GITHUB_TOKEN` (gist scope).

## What to do to run in production
1) Share backend:
   - Deploy drawdb-server (Node) with `GITHUB_TOKEN` (gist scope), `PORT`, and any email envs you need.
   - Expose it over HTTPS; set frontend `VITE_BACKEND_URL=https://your-share-backend`.
2) Collab backend:
   - Deploy `server/` from this repo; env:
     - `COLLAB_PORT` (default 4000)
     - `PERSIST_BASE_URL=https://your-share-backend` (to flush to drawdb-server)
     - Optional: `PERSIST_FILENAME` (default `share.json`), `PERSIST_FLUSH_MS` (default 30000), `PERSIST_OPS_THRESHOLD` (default 50)
   - Expose as WSS; set frontend `VITE_COLLAB_WS_URL=wss://your-collab-backend`.
3) Frontend:
   - Build with the above env vars baked in; ensure CORS/WS origins allow your domains.
4) Security hardening:
   - Use TLS for both HTTPS and WSS.
   - Keep `GITHUB_TOKEN` secret (only on the share backend).
   - Restrict allowed origins in both servers.

## Docker/Compose example
> Adjust paths/domains to your setup; this assumes you have drawdb-server in a sibling directory and want to run both backends together.

```yaml
version: "3.9"
services:
  share-backend:
    build: ../drawdb-server
    env_file: ../drawdb-server/.env
    environment:
      - PORT=3001
    ports:
      - "3001:3001"

  collab-backend:
    build: ./server
    environment:
      - COLLAB_PORT=4000
      - PERSIST_BASE_URL=http://share-backend:3001
      - PERSIST_FILENAME=share.json
      - PERSIST_FLUSH_MS=30000
      - PERSIST_OPS_THRESHOLD=50
    depends_on:
      - share-backend
    ports:
      - "4000:4000"
```

Run with `docker-compose -f docker-compose.collab.yml up --build` (after adjusting paths). Point your frontend env to `VITE_BACKEND_URL=http://localhost:3001` and `VITE_COLLAB_WS_URL=ws://localhost:4000`.

## Next steps (not yet done)
- Add table-level locks and granular ops (e.g., upsert-table/field/relationship) to reduce payload size and support conflict handling.
- Surface presence (names/cursors) and lock UX in the UI.
- Improve error/reporting: notify clients when persistence fails, add health checks, rate limits.
- Production artifacts: add reverse proxy/TLS termination (nginx/traefik) and CI builds for the collab server image.
