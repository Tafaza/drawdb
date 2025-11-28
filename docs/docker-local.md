Local Docker setup
==================

This runs the frontend, collab server, and backend together on localhost via Docker Compose.

Prereqs
-------
- Docker Engine + Compose plugin installed (WSL2/Ubuntu): `docker --version` should work.
- Folder layout with the backend repo alongside this one:
  - `~/drawdb-stack/drawdb` (this repo)
  - `~/drawdb-stack/drawdb-server` (clone https://github.com/drawdb-io/drawdb-server)

Setup steps
-----------
1) From the stack directory:
```bash
mkdir -p ~/drawdb-stack
cd ~/drawdb-stack
git clone https://github.com/drawdb-io/drawdb.git drawdb   # if not already
git clone https://github.com/drawdb-io/drawdb-server.git   # backend
cd drawdb
```

2) Optional: create `.env` next to `docker-compose.local.yml` to override defaults:
```
VITE_BACKEND_URL=http://localhost:3001/api
VITE_COLLAB_WS_URL=ws://localhost:4000/collab
CLIENT_URLS=http://localhost:3000
PORT=5000
GITHUB_TOKEN=ghp_xxx            # only if you need gist sharing
```

3) Bring up the stack:
```bash
docker compose -f docker-compose.local.yml up --build -d
```

4) Check status and logs:
```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f drawdb-frontend
docker compose -f docker-compose.local.yml logs -f drawdb-collab
docker compose -f docker-compose.local.yml logs -f drawdb-server
```

Ports and URLs
--------------
- Frontend: http://localhost:3000
- Collab WS: ws://localhost:4000/collab
- Backend API: http://localhost:3001 (internally exposed as 5000)

Notes
-----
- The backend uses a bind mount to `../drawdb-server`, so local code changes are reflected without rebuilding.
- The backend command installs dependencies on container start (`npm install --include=dev && npm run dev`). For faster starts, you can pre-install on the host inside `drawdb-server`.
- If you change ports, keep `CLIENT_URLS`, `VITE_BACKEND_URL`, and `VITE_COLLAB_WS_URL` in sync.
