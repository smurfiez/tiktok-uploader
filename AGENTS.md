# AGENTS.md

Repository guidance. `docs/PLAN.md` is the authoritative spec; read it before changing behavior.
Docs rule: every Markdown file lives in `docs/`, except `README.md` and `AGENTS.md`.

## Layout

npm workspaces, Node 20+, no Python (the old Python tree is gone):

- `packages/core` — engine: profiles, auth, upload, scheduling, queue. Uses
  `playwright-core` against the user's installed Chrome/Edge/Brave (`CHROME_PATH` overrides);
  there is no bundled browser to install.
- `packages/cli` — `tiktok-up` (commander), TTY output or NDJSON with `--json`,
  exit codes 0–6 (`ExitCode` in `packages/cli/src/exitCodes.ts`).
- `packages/desktop` — Electron + electron-vite. Main/IPC owns side effects,
  preload exposes `window.api`, React renderer is a pure view. IPC contract lives
  in `packages/desktop/src/preload/index.d.ts`; keep it in sync with
  `src/main/ipc.ts`.
- Import core only through `packages/core/src/index.ts` (`@tiktok-uploader/core`);
  there are no deep package imports.
- A job caption (`Job.description`) is a `<video>.txt` sidecar
  (`videos.ts: sidecarTitle`) or empty; there are no model calls.

## Commands

```bash
npm test                                        # all Vitest tests, no browser/network
npx vitest run packages/core/tests/schedule.test.ts   # single file
npm run typecheck                               # core -> cli -> desktop
npm run build:cli                               # builds core first, then the bin
npm run dev:desktop                             # electron-vite dev
npm run dist:desktop                            # electron-builder, host OS only
```

- `build:cli` order matters: the CLI resolves `@tiktok-uploader/core` through
  `dist/index.js`, so core must be compiled first. Desktop dev aliases core to
  `../core/src` (see `electron.vite.config.ts`), so it needs no core build.
- Desktop typecheck is two passes (`tsconfig.node.json` + `tsconfig.web.json`).
- There is no lint or formatter config; match the style of surrounding code: no
  semicolons, single quotes, 2-space indent.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, then `npm run typecheck`, then
  `npm test`; run the same order before calling work done.

## Invariants

- `packages/core` must never import `electron`.
- All TikTok selectors, URLs and waits live in `packages/core/src/selectors.ts`.
  A TikTok DOM change is a one-file fix.
- The renderer never touches fs, profiles or cookies — only `window.api`.
- One browser profile per account, guarded by `account.lock` (stale PID is
  reclaimed). Contention must fail cleanly with exit code 4, never open the
  profile twice.
- Uploads run headless by default; `login` and `--headed` are visible. Every
  caught upload failure saves a full-page screenshot to `profiles/<id>/failures/`.
- Schedules must be 5-minute aligned, ≥20 minutes ahead and within
  `maxScheduleDays` (10; 30 for Studio accounts). Drafts and scheduling are
  mutually exclusive.
- All state goes through `packages/core/src/paths.ts` (`TIKTOK_UPLOADER_HOME`
  overrides the OS data dir; desktop and CLI share it). Path helpers read the env
  per call — do not cache them at module load, or tests' temp homes leak.

## Testing

Vitest only, from the repo root (`vitest.config.ts` globs `packages/*/tests`).
Covers cookies, schedules, profiles/locks, videos, queue and CLI
formatting/exit codes. Tests isolate state by setting `TIKTOK_UPLOADER_HOME` to
a temp dir. Anything touching a real browser (login, draft, scheduled post, lock
collision, failure screenshot) is a manual check — see `docs/PLAN.md` §14.
