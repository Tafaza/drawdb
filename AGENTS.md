# Repository Guidelines

Use this guide to get productive quickly and keep contributions consistent with the existing codebase.

## Project Structure & Module Organization
- `src/` holds all app code. Key areas: `components/` (reusable UI), `pages/` (route-level views), `context/` (providers), `hooks/`, `utils/`, `data/`, and `templates/` for prebuilt diagrams/content. Entry points live in `main.jsx` and `App.jsx`.
- Styling comes from `index.css`, Tailwind config (`tailwind.config.js`), and component-level styles. Static assets live in `public/` and `src/assets/`.
- API calls are centralized in `src/api/`; DBML/diagram logic lives alongside UI components.

## Build, Test, and Development Commands
- Install deps: `npm install`
- Run locally with HMR: `npm run dev`
- Production bundle: `npm run build`
- Preview built assets: `npm run preview`
- Lint for common issues: `npm run lint`

## Coding Style & Naming Conventions
- Use Prettier defaults (2-space indent, semicolons off) and keep ESLint clean; run `npm run lint` before PRs.
- Components/hooks in PascalCase; utility functions and variables in camelCase; CSS classes follow Tailwind patterns.
- Keep strings, comments, and identifiers in English. Co-locate component-specific styles and assets near their components.
- Prefer functional components with hooks; avoid mutating props/state directly. When adding i18n strings, place keys under `src/i18n/` and reuse existing namespaces.

## Testing Guidelines
- No automated test suite is present; rely on `npm run lint` and manual QA in `npm run dev`.
- When you make code changes, run `npm run lint` at minimum to catch regressions early.
- For new tests, place them near the code under `src/` using Vitest or React Testing Library; name files `*.test.jsx`. Smoke-test critical flows (diagram creation, export/import) before shipping.

## Environment & Security Notes
- API clients expect `VITE_BACKEND_URL` in `.env.local`; do not commit secrets. Keep network logic inside `src/api/` to centralize configuration and error handling.
- Avoid storing large binaries in repo history; use `public/` or an external store for shared assets.

## Commit & Pull Request Guidelines
- Commit messages: present-tense, imperative (e.g., `Add dark mode toggle`); reference issues when available.
- Keep PRs focused and small. Include: purpose, key changes, how to verify (`npm run dev` steps or reproduction), and screenshots/GIFs for UI updates.
- Update documentation when behavior changes (README, this guide, or inline comments). Label PRs/issues consistently with existing GitHub labels.
