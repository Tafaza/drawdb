# Sharing Links and Stored State

This app publishes read-only share links through the backend gist API (`VITE_BACKEND_URL`). It does not keep a central list of shared diagrams; links are discoverable only if you keep the ID yourself or save the opened diagram locally.

## How a Share Link is Created
- Trigger: the Share modal (`src/components/EditorHeader/Modal/Share.jsx`).
- Action: calls the backend (`src/api/gists.js`) to create or patch a gist file named `share.json` containing the current diagram (title, tables, relationships, notes, subject areas, database, and optional enums/types).
- Result: a URL in the shape `https://your-host/path?shareId=<gistId>`. GitHub gists are flat, so there is no nested `drawdb/<gistId>/share.json` structure—only `<gistId>/share.json`.
- Unshare: the Share modal patches the same gist to remove `share.json`, clearing the link while leaving any locally saved copies untouched.

## How a Share Link Loads
- Entry: when the app detects `?shareId=<gistId>` in the URL, `Workspace` (`src/components/Workspace.jsx`) fetches the gist and parses `share.json`.
- State hydration: the diagram content is applied to the editor and collaboration share ID is set to the same gist ID (if the collab server is enabled).
- Failure: if the gist fetch or parse fails, the load is marked as failed (`State.FAILED_TO_LOAD`).

## Local Persistence
- Local saves are stored in IndexedDB via Dexie (`src/data/db.js`, `db.diagrams`).
- When a diagram originates from a share link, the saved record includes `gistId` and `loadedFromGistId` so it can be reopened from the Open modal (`src/components/EditorHeader/Modal/Open.jsx`).
- There is no global index of shared gists in the app. To build a “list diagrams” page, add your own index (backend endpoint or local catalog) instead of relying on gist path conventions.
