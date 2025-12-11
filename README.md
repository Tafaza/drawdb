<div align="center">
  <sup>Special thanks to:</sup>
  <br>
  <a href="https://www.warp.dev/drawdb/" target="_blank">
    <img alt="Warp sponsorship" width="280" src="https://github.com/user-attachments/assets/c7f141e7-9751-407d-bb0e-d6f2c487b34f">
    <br>
    <b>Next-gen AI-powered intelligent terminal for all platforms</b>
  </a>
</div>

<br/>
<br/>

<div align="center">
    <img width="64" alt="drawdb logo" src="./src/assets/icon-dark.png">
    <h1>drawDB</h1>
</div>

<h3 align="center">Free, simple, and intuitive database schema editor and SQL generator.</h3>

<div align="center" style="margin-bottom:12px;">
    <a href="https://drawdb.app/" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/Start%20building-grey" alt="drawDB"/>
    </a>
    <a href="https://discord.gg/BrjZgNrmR6" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/discord/1196658537208758412.svg?label=Join%20the%20Discord&logo=discord" alt="Discord"/>
    </a>
    <a href="https://x.com/drawDB_" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/Follow%20us%20on%20X-blue?logo=X" alt="Follow us on X"/>
    </a>
    <a href="https://getmanta.ai/drawdb">
        <img src="https://getmanta.ai/api/badges?text=Manta%20Graph&link=drawdb" alt="DrawDB graph on Manta">
    </a> 
</div>

<h3 align="center"><img width="700" style="border-radius:5px;" alt="demo" src="drawdb.png"></h3>

DrawDB is a robust and user-friendly database entity relationship (DBER) editor right in your browser. Build diagrams with a few clicks, export sql scripts, customize your editor, and more without creating an account. See the full set of features [here](https://drawdb.app/).

## Getting Started

### Local Development

```bash
git clone https://github.com/drawdb-io/drawdb
cd drawdb
npm install
npm run dev
```

### Build

```bash
git clone https://github.com/drawdb-io/drawdb
cd drawdb
npm install
npm run build
```

### Docker Build

```bash
docker build -t drawdb .
docker run -p 3000:80 drawdb
```

### Local full stack (Docker Compose)

Run the frontend + collab WS + backend locally in containers (good for testing sharing/collab):

1. Clone this repo and `drawdb-server` side by side (e.g., `~/dev/drawdb-stack/drawdb` and `~/dev/drawdb-stack/drawdb-server`).
2. Create a `.env` next to `docker-compose.local.yml` if you need overrides like `VITE_BACKEND_URL`, `VITE_COLLAB_WS_URL`, `PORT`, `COLLAB_PORT`, `CLIENT_URLS`, or `GITHUB_TOKEN` (required for gist sharing/revisions to show up). Set `PERSIST_BASE_URL` if you want collab changes to be persisted (strongly recommended outside dev).
3. From `drawdb/`, run `docker compose -f docker-compose.local.yml up --build -d`.
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Collab WS: ws://localhost:4000
4. Iterating on code: backend hot-reloads via the volume mount + `npm run dev`; frontend/collab server changes need a rebuild (`docker compose -f docker-compose.local.yml up --build -d`).

### Sharing backend (drawdb-server)

If you want to enable sharing, you need the optional [drawdb-server](https://github.com/drawdb-io/drawdb-server) running and a GitHub token with gist scope:

- Create a PAT with the `gist` scope (GitHub → Settings → Developer settings → Personal access tokens (classic) → New token).
- Put that token in the drawdb-server `.env` as `GITHUB_TOKEN=<your_token>` (keep it off the frontend).
- Start drawdb-server (see its README) and point the app to it using the `.env.sample` values (e.g., `VITE_BACKEND_URL`).
- For live collaboration, also start the collab WS server in `server/` (`COLLAB_PORT`, optional `PERSIST_BASE_URL` to flush to drawdb-server). See `docs/collab/COLLAB_SETUP.md` / `docs/collab/COLLAB_DEPLOYMENT.md` for details.

## Docs

- Sharing links and local persistence: `docs/sharing.md`
- Collaboration setup and deployment: `docs/collab/`
