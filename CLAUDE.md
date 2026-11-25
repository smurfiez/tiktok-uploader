# CLAUDE.md

Guidance for agents working in this repository.

## Project

TikTok Uploader is a TypeScript monorepo (npm workspaces) with one shared upload
engine and two front ends. There is no Python in this repo; it is a fork inspired
by `wkaisertexas/tiktok-uploader`.

- `packages/core` — zero-Electron Node/TypeScript engine: browser profiles,
  session handling, TikTok selectors, scheduling, captions, persisted queue.
  Uses `playwright-core` against the user's installed Chrome/Edge/Brave.
- `packages/cli` — `tiktok-up` command line (commander), human TTY output or
  NDJSON with `--json`, deterministic exit codes 0-6.
- `packages/desktop` — Electron app (electron-vite): main process owns all
  side effects, preload exposes a narrow typed `window.api`, React renderer is
  a pure view.
- `PLAN.md` — the authoritative spec. Read it before changing behavior.

## Commands

```bash
npm install                 # install all workspaces
npm test                    # vitest across packages
npm run typecheck           # core + cli + desktop tsc
npm run build:core          # compile core to packages/core/dist
npm run build:cli           # core then cli; bin at packages/cli/dist/index.js
npm run dev:desktop         # electron-vite dev
npm run dist:desktop        # electron-builder for the host OS
```

## Invariants

- `packages/core` must never import `electron`. All side effects used by the
  desktop app go through core or the Electron main process.
- Every TikTok selector, path and wait lives in `packages/core/src/selectors.ts`.
  A DOM change is a one-file fix.
- The renderer never touches the filesystem, browser profiles, cookies or API
  keys. It only calls `window.api` (contract: `packages/desktop/src/preload/index.d.ts`).
- API keys never cross IPC. Desktop encrypts with `safeStorage`; the CLI and
  cron use `MODEL_ACCESS_KEY`.
- One browser profile per account, guarded by `account.lock` (PID lockfile).
  Concurrent runs on the same account must fail cleanly, never open the
  profile twice.
- Batches run headless by default; login is always headed. Every caught upload
  error saves a full-page screenshot to `profiles/<accountId>/failures/`.
- Schedules are on TikTok's 5-minute grid, at least 20 minutes ahead, inside
  `maxScheduleDays` (10 default, 30 for Studio).

## Style

No semicolons, single quotes, 2-space indent, `async/await` over callbacks,
prefer small pure functions in core. Keep dependencies minimal: `playwright-core`,
`commander`, React and Electron only.

## Testing

Unit tests are Vitest, no network and no browser: `packages/core/tests` covers
cookies, scheduling/stagger, captions, profiles/locks, videos and the queue;
`packages/cli/tests` covers NDJSON formatting and exit codes. Manual smoke
checks (login, draft upload, lock collision) are listed in `PLAN.md` §14.
