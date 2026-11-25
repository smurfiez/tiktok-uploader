# TikTok Uploader — Unified Desktop App & CLI

Status: **implemented (v1)** — monorepo, core, CLI and desktop app are on disk;
`npm run typecheck`, `npm test` and `electron-vite build` pass. Real-browser
smoke checks (login, upload, lock collision) are still manual, see §14.
Owner: smurf. Target: macOS, Windows, Linux.

---

## 1. Goal

A double-clickable desktop app **and** a scriptable Node CLI powered by the same TypeScript upload engine: manage multiple TikTok accounts, drop a folder of videos, review or auto-generate captions, bulk-stagger or fine-tune schedules, press Run (or trigger via cron), and track progress with machine-readable logs and failure screenshots. No terminal required for desktop use; no Python required at runtime.

Non-goals for v1 (explicitly deferred): custom cover images, product links, proxy configuration, a built-in background scheduler daemon (use OS cron + the CLI instead), MCP integration, history/analytics.

---

## 2. Architecture decision

**Extract a zero-Electron TypeScript core (`packages/core`) using `playwright-core`, shared by both the CLI (`packages/cli`) and the Electron desktop app (`packages/desktop`). Do not ship Python.**

Why:
- Keeping Python for the CLI while maintaining a TypeScript port for Electron guarantees drift every time TikTok changes its DOM.
- A shared TypeScript core gives both interfaces one selector file, one scheduling engine, one persistent-profile auth layer, and one unit test suite.
- The existing Python package in the repo stays untouched if still needed for legacy/MCP workflows, but the desktop app and new CLI have zero runtime dependency on it.

Runtime shape:

```text
Desktop Renderer (React, sandboxed) ──ipc──▶ Desktop Main (Node) ──┐
                                              dialogs, windows      ├──▶ packages/core ──▶ Chromium via playwright-core
CLI (Node / Commander) ────────────────────────────────────────────┘     profiles, locks,   (persistent context,
   pretty TTY or --json NDJSON, exit codes                               queue, upload       headless by default)
```

All side effects live in `packages/core` and the Electron main process. The renderer is a pure view: it never touches the filesystem, browser profiles or cookies.

---

## 3. Repository layout

An npm workspaces monorepo inside this repo; the Python package is unaffected. Existing `[done]` modules from `app/src/main/` migrate directly into `packages/core/src/`.

```text
package.json                        npm workspaces root ("packages/*")                  [todo]
tsconfig.base.json                  shared TypeScript compiler options                  [todo]
docs/PLAN.md                        this file                                           [done]

packages/
  core/                             Pure Node/TS (zero Electron imports)
    package.json                    playwright-core, vitest                             [todo]
    src/
      types.ts                      Job, Account, Settings, QueueEvent, ScheduleRule    [migrate]
      paths.ts                      OS data dir & per-account profile path resolver     [todo]
      profiles.ts                   multi-account registry, PID lockfiles               [todo]
      selectors.ts                  every path, wait, and XPath (single source)         [migrate]
      utils.ts                      sleep, duration parser                              [migrate]
      cookies.ts                    Netscape parse/serialize (import/export fallback)   [migrate]
      schedule.ts                   round-to-5, validity window, bulk stagger + jitter  [migrate+extend]
      queue.ts                      persisted queue.json, serial runner, EventEmitter   [todo]
      uploader/
        browser.ts                  Chrome/Edge/Brave discovery, native UA,             [migrate+update]
                                    launchPersistentContext, headless default
        auth.ts                     session check, headed loginInteractive,             [migrate+update]
                                    cookies.txt bootstrap fallback, captcha detection
        upload.ts                   complete_upload_form port + failure screenshots     [migrate+update]
    tests/*.test.ts                 cookies, schedule, stagger, locks, files           [todo]

  cli/                              Thin Node CLI (`tiktok-up`)
    package.json                    bin: tiktok-up, commander                           [todo]
    src/
      index.ts                      accounts, login, auth, cookies, upload, queue,      [todo]
                                    doctor
      format.ts                     human TTY reporter vs --json NDJSON stream          [todo]
      exitCodes.ts                  deterministic exit codes (0-6)                      [todo]

  desktop/                          Electron app (electron-vite + electron-builder)
    package.json                    mac/win/linux targets, asarUnpack                   [migrate]
    electron.vite.config.ts         main / preload / renderer builds                    [migrate]
    src/
      main/
        ipc.ts                      ipcMain handlers, dialogs, powerSaveBlocker         [todo]
        index.ts                    window lifecycle, security policy, event bridge     [todo]
      preload/
        index.ts                    contextBridge API + webUtils.getPathForFile         [todo]
        index.d.ts                  window.api typing                                   [todo]
      renderer/
        index.html                  strict CSP meta, root mount                         [todo]
        src/main.tsx                React mount                                         [todo]
        src/App.tsx                 account switcher, queue table, bulk scheduler,      [todo]
                                    pre-run confirm modal, settings, log drawer
        src/styles.css              dark theme, TikTok red accent                       [todo]
  README.md                         install, login, UI guide, CLI & cron examples       [todo]
```

---

## 4. Port map (Python → TypeScript) and deliberate deviations

| Python (`upload.py`, `auth.py`, `captions.py`) | TypeScript (`packages/core`) | Notes |
|---|---|---|
| `TikTokUploader.upload_video` | `uploader/upload.ts: uploadVideo` | one job, one page; saves screenshot on any failure |
| `complete_upload_form` | `uploadVideo` body | step order preserved; fail-fast on captcha/login redirect |
| `_go_to_upload` | `goToUpload` | reload when already on the upload page |
| `_set_video` (3 retries) | `setVideo` | waits for `resolution-label-text` |
| `_remove_cookies_window`, `_remove_split_window`, `_remove_onboarding_tour` | `removeCookiesBanner`, `removeSplitWindow`, `dismissOnboardingTour` | same dismissal + portal removal fallback |
| `_set_interactivity` | `setInteractivity` | comment/stitch/duet, XOR semantics |
| `_set_description` (+ pickers) | `setDescription`, `pickHashtag`, `pickMention` | same fallback: clear + `fill` |
| `_clear` | `clear` | `ControlOrMeta+A` + Backspace |
| `_set_visibility` | `setVisibility` | failure is non-fatal, as upstream |
| `_set_ai_label` | `setAiLabel` | failure is fatal, as upstream |
| `_set_schedule_video`, date/time pickers & verifiers | `setSchedule`, `pickDate`, `pickTime`, `verifyDate`, `verifyTime` | `Intl` in the page's timezone (no `pytz`) |
| `_post_video`, `_save_draft` | `postVideo`, `saveDraft` | waits on `data-disabled` / confirmation / detach |
| `_add_product_link`, `_set_cover` | **not ported** | deferred, see non-goals |
| `_check_valid_path` | `isSupportedVideo` | **fix in P0:** import value `SUPPORTED_VIDEO_TYPES` instead of re-listing |
| `_get_valid_schedule_minute`, `_check_valid_schedule` | `schedule.ts: roundUpToFive`, `isValidSchedule`, `buildStaggeredSchedule` | extended with bulk stagger, jitter, quiet-hours window |
| `AuthBackend.authenticate_agent` | `auth.ts: ensureAuthenticated` | **deviation:** uses persistent browser profile; falls back to `cookies.txt` |
| `login()` (credentials + captcha) | `auth.ts: loginInteractive` | **deviation:** always opens a headed window for real sign-in (QR/2FA/captcha) |
| `get_cookies`, `save_cookies` | `cookies.ts: parseNetscape`, `serializeNetscape` | kept for import/export compatibility with legacy tools |
| `source_title`, `rewrite_caption`, `auto_caption` | **removed** | AI caption generation dropped; `videos.ts: sidecarTitle` still reads `<video>.txt` |
| `browsers.get_browser` | `uploader/browser.ts: launchContext` | **deviation:** `launchPersistentContext`, auto-detect Chrome/Edge/Brave, native UA (no Chrome-58 spoof) |
| `chromeCookies.ts` (v1 draft) | **removed** | copying live Chrome profiles breaks on Windows App-Bound Encryption & macOS Keychain |

---

## 5. Multi-account data model, storage & concurrency

Both the desktop app and CLI share a single OS-standard data directory (`TIKTOK_UPLOADER_HOME` overrides):
- macOS: `~/Library/Application Support/tiktok-uploader`
- Windows: `%APPDATA%\tiktok-uploader`
- Linux: `$XDG_CONFIG_HOME/tiktok-uploader` (fallback `~/.config/tiktok-uploader`)

```text
<dataDir>/
  settings.json                   # Global defaults
  accounts.json                   # [{ id, label, handle?, createdAt }]
  profiles/
    <accountId>/
      browser-profile/            # Playwright persistent context (cookies, localStorage, IndexedDB)
      cookies.txt                 # Optional Netscape fallback (0600 on POSIX)
      queue.json                  # Persisted queue rows & statuses (resume + retry failed)
      account.lock                # PID lockfile preventing concurrent runs on the same account
      failures/                   # <timestamp>-<jobId>.png failure screenshots
```

`settings.json`:

```jsonc
{
  "defaultAccount": "default",
  "headless": true,
  "browserPath": "",              // Auto-detected Chrome/Edge/Brave when empty
  "maxScheduleDays": 10,          // 10 for standard web accounts, 30 for TikTok Studio
  "visibility": "everyone",
  "aiLabel": true
}
```

- **Concurrency & Lockfile (`account.lock`):** Playwright persistent contexts cannot be opened by two processes simultaneously. Before launching a browser for an account, `core` writes `{ pid, source, startedAt }` to `account.lock` using exclusive file creation (`wx`). Stale locks (where the PID is no longer alive) are automatically reclaimed. Different accounts can run in parallel (e.g., Account A in the UI while cron runs Account B); colliding runs on the same account fail cleanly with exit code `4` (CLI) or an inline banner (UI).

---

## 6. Auth & browser strategy

1. **Primary — Persistent Browser Context (`launchPersistentContext`):**
   - `tiktok-up login --account main` or clicking **Sign In** in the UI always opens a **headed** browser pointed at `profiles/<accountId>/browser-profile/`.
   - User signs in normally. Cookies, `localStorage`, IndexedDB, and device tokens persist across both UI and CLI runs.
2. **Fallback — Netscape `cookies.txt`:**
   - Supported via `tiktok-up cookies import/export` and the UI account menu for migrating sessions or bootstrapping headless servers.
   - If `browser-profile/` has no active session on startup and `cookies.txt` exists, `auth.ts` injects it once into the persistent context.
3. **Browser & User-Agent:**
   - Auto-detect installed Chromium browsers in order: `CHROME_PATH` env var → `settings.browserPath` → Chrome → Edge → Brave → Chromium.
   - Use the installed browser's real User-Agent and Client Hints (no Chrome-58 spoofing) to avoid UA/TLS fingerprint mismatches.
4. **Headless by Default, Headed by Choice:**
   - All upload batches run headless by default (`headless: true`).
   - Override per run with `--headed` (CLI) or the **Show browser** toggle (UI).
   - Login flows always force `headless: false`.

---

## 7. Scheduling & validation rules

- **Two scheduling modes (combinable):**
  - **Bulk Auto-Stagger (`buildStaggeredSchedule`):** Given `start` (ISO or relative like `tomorrow 18:00`), `every` (`12h`, `1d`, `2d`), optional `jitter` (e.g., `15m` random offset rounded to TikTok's 5-minute grid), and optional `window` (e.g., `09:00-21:00` quiet-hours guard), computes timestamps for all queued rows.
  - **Exact Per-Row Editing:** Every row in the UI has an editable `datetime-local` input so individual slots can be tweaked after bulk staggering.
- **TikTok constraints enforced in both UI and CLI:**
  - Minimum lead time: at least **20 minutes** from upload time (re-checked right before each job executes so a long batch does not miss an early slot).
  - Maximum horizon: configurable `maxScheduleDays` (default **10 days**, switchable to **30 days** in Settings or `--max-schedule-days`).
  - Mutual exclusions: scheduling is rejected/disabled when **Draft** is enabled **or** when **Visibility** is set to **Private** ("Only me").
  - Caption limits: soft warning over **150 characters** (feed truncation preview); hard validation error over **2,200 characters**.

---

## 8. CLI specification (`tiktok-up`)

Built for manual terminal runs, unattended cron jobs, and script pipelines.

### Commands

```bash
# Accounts & authentication
tiktok-up accounts list [--json]
tiktok-up accounts add <id> [--label "Brand Main"]
tiktok-up accounts label <id> "Brand Main"
tiktok-up accounts remove <id>
tiktok-up login --account <id>
tiktok-up auth status --account <id> [--json]
tiktok-up cookies import <file> --account <id>
tiktok-up cookies export <file> --account <id>

# Upload & schedule
tiktok-up upload <files-or-dir...> \
  --account <id> \
  --start "2026-12-01 18:00" \
  --every 24h \
  --jitter 15m \
  --window "09:00-21:00" \
  --visibility everyone|friends|private \
  --draft \
  --ai-label / --no-ai-label \
  --headed \
  --dry-run \
  --json

# Queue inspection & recovery (shares queue.json with the UI)
tiktok-up queue status --account <id> [--json]
tiktok-up queue retry-failed --account <id> [--headed] [--json]
tiktok-up queue clear --account <id> [--completed-only]

# Diagnostics
tiktok-up doctor --account <id> [--json]   # Verifies browser, session, and TikTok DOM selectors
```

### Machine-readable output (`--json`)

When `--json` is passed, `stdout` emits one JSON object per line (NDJSON); all human/debug noise goes to `stderr`:

```json
{"ts":"2026-12-01T10:00:01Z","event":"batch_start","account":"main","total":3,"headless":true}
{"ts":"2026-12-01T10:00:05Z","event":"job_stage","jobId":"1","file":"clip1.mp4","stage":"uploading"}
{"ts":"2026-12-01T10:01:12Z","event":"job_done","jobId":"1","file":"clip1.mp4","scheduledAt":"2026-12-01T18:00:00Z"}
{"ts":"2026-12-01T10:01:18Z","event":"job_failed","jobId":"2","file":"clip2.mp4","stage":"caption","error":"Captcha challenge detected; retry with --headed","screenshot":"/path/to/failures/2026-12-01-2.png"}
{"ts":"2026-12-01T10:02:40Z","event":"batch_done","done":2,"failed":1,"skipped":0}
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All jobs succeeded (or `--dry-run` passed validation) |
| `1` | Unexpected runtime error |
| `2` | Invalid CLI arguments, missing files, or schedule/caption validation error |
| `3` | Authentication expired, missing, or blocked by a captcha challenge |
| `4` | Account lock busy (another UI or CLI process holds `account.lock`) |
| `5` | Partial failure (at least one job succeeded and at least one failed) |
| `6` | All jobs failed |

---

## 9. IPC contract (`packages/desktop`)

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `settings:get` | invoke | — | `Settings` |
| `settings:set` | invoke | `Partial<Settings>` | `Settings` |
| `accounts:list` | invoke | — | `AccountSummary[]` (includes auth & lock status) |
| `accounts:add` | invoke | `{ id, label }` | `AccountSummary` |
| `accounts:remove` | invoke | `accountId` | `{ ok }` |
| `auth:status` | invoke | `accountId` | `AuthStatus` |
| `auth:login` | invoke | `accountId` | `{ ok, message }` (always headed) |
| `auth:import-cookies` | invoke | `accountId` | `{ ok, message }` (file dialog) |
| `auth:export-cookies` | invoke | `accountId` | `{ ok, path? }` (save dialog) |
| `videos:pick` | invoke | — | `string[]` |
| `videos:pick-folder` | invoke | — | `string \| null` |
| `videos:list` | invoke | `directory` | `VideoItem[]` |
| `schedule:stagger` | invoke | `{ count, rule }` | `string[]` (ISO timestamps) |
| `queue:load` | invoke | `accountId` | `Job[]` |
| `queue:save` | invoke | `{ accountId, jobs }` | `{ ok }` |
| `queue:start` | invoke | `{ accountId, jobs, headed? }` | `{ started, error? }` |
| `queue:stop` | invoke | `accountId` | `{ stopped }` |
| `queue:event` | main → renderer | `QueueEvent` | — |

---

## 10. Queue semantics & headless resilience

- **Serial per account:** One browser context, one page, one job at a time per account.
- **Persisted by default:** Every edit, status transition, error message, and failure screenshot path is written to `profiles/<accountId>/queue.json`. Quitting or crashing mid-batch preserves pending and failed rows for instant resume or **Retry Failed**.
- **Failure screenshots from P0/P1:** Because batches run headless by default, every caught error in `upload.ts` captures a full-page PNG to `profiles/<accountId>/failures/<timestamp>-<jobId>.png` and attaches the path to the `job_failed` event.
- **Fail-fast captcha & auth checks:** Detect TikTok captcha overlays or redirects to `/login` immediately rather than waiting for a 60-second selector timeout. Abort the remaining batch with exit code `3` and instruct the user to run `--headed` / toggle **Show browser** or re-authenticate.
- **Cooperative stop:** In-flight job completes (avoiding half-committed posts); remaining pending jobs become `skipped`.
- **Single crash recovery:** If the browser process dies mid-batch, relaunch once and continue from the next job.
- **Sleep prevention:** Desktop main process holds `powerSaveBlocker.start('prevent-app-suspension')` while a batch is active and releases it on finish/stop.

---

## 11. Cross-platform matrix

| Concern | macOS | Windows | Linux |
|---|---|---|---|
| Browser discovery | `CHROME_PATH` → Chrome/Edge/Brave in `/Applications` | `CHROME_PATH` → Registry / Program Files Chrome/Edge/Brave | `CHROME_PATH` → `which` google-chrome / chromium / brave |
| Shared data root | `~/Library/Application Support/tiktok-uploader` | `%APPDATA%\tiktok-uploader` | `$XDG_CONFIG_HOME/tiktok-uploader` |
| Cookie fallback perms | `0600` | User profile ACL | `0600` |
| Lockfile check | `process.kill(pid, 0)` | `process.kill(pid, 0)` | `process.kill(pid, 0)` |
| Desktop installer | `dmg` | `nsis` | `AppImage`, `deb` |
| Signing | Ad-hoc signed, not notarized: right-click → Open once | Unsigned: SmartScreen "Run anyway" | None |

---

## 12. Desktop UI (v1)

Single window, three regions + two lightweight modals:

1. **Toolbar** — Account switcher dropdown (with `Signed in` / `Expired` / `Locked by CLI` chip + Sign In / Add Account actions), Add videos, Add folder, **Bulk Schedule**, **Retry Failed**, Clear, **Show browser** toggle (off by default), Settings gear, Run, Stop.
2. **Queue table** — one row per video: filename, sidecar/filename title, caption textarea (soft badge over 150 chars, red error over 2,200 chars), schedule `datetime-local` (disabled when Draft or Private), visibility select, Draft / AI label / Comment / Duet / Stitch toggles, status pill, inline error with clickable failure screenshot link.
3. **Log drawer** — timestamped live stream, auto-scrolled, copyable.
4. **Bulk Schedule modal** — start date/time, interval (`every`), optional jitter, quiet-hours window, live preview of generated timestamps before applying to rows.
5. **Pre-Run Confirmation modal** — displays target account, total count, schedule span, visibility summary, and missing captions before starting (guards against TikTok's inability to edit scheduled posts).

Drop-zone accepts files/folders via `webUtils.getPathForFile` in preload.

---

## 13. Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, narrow typed `contextBridge` API.
- Renderer CSP `default-src 'self'`, no remote content, no embedded webviews.
- Block `will-navigate` and `setWindowOpenHandler` outside `tiktok.com` origins.
- Cookie values never cross IPC.
- `cookies.txt` written with `0600` permissions on POSIX; `browser-profile/` stays inside the OS user profile directory.

---

## 14. Testing plan

Unit tests (Vitest in `packages/core` and `packages/cli`, no network, no browser):
- `cookies`: Netscape parse (`#HttpOnly_`, comments, malformed rows), serialize round-trip, `sessionIdOf`.
- `schedule`: `roundUpToFive`, validity edges (20 min min, 10/30-day max), `buildStaggeredSchedule` (intervals, jitter rounding, quiet-hours window wrapping), `calendarSteps`, `partsInZone` across DST.
- `profiles`: account add/list/remove, PID lock acquisition, live-PID contention rejection, stale-PID lock reclamation.
- `videos`: `sidecarTitle` with/without sidecar and `isSupportedVideo` across extensions and casing.
- `cli`: NDJSON serialization, `--dry-run` validation, exit code mapping (`0`–`6`).

Manual smoke checklist (per OS):
- CLI `login` → verify desktop UI immediately shows the same account as `Signed in`.
- CLI `upload --dry-run --json` and real draft + scheduled upload (headless).
- Lock collision test: run CLI while UI holds the same account → verify exit code `4`.
- Failure path: trigger an error headless → verify screenshot saved in `failures/` and linked in UI + CLI JSON.
- Desktop packaged build launches, reads shared `<dataDir>`, and runs a headless draft upload.

---

## 15. Build and distribution

Root workspace scripts:
- `npm run typecheck` — typechecks `core`, `cli`, and `desktop`.
- `npm test` — runs Vitest across all workspaces.
- `npm run dev:desktop` — `electron-vite` dev server.
- `npm run build:cli` — compiles `packages/cli` (`tiktok-up` bin ready for `npm link` or global install).
- `npm run dist:desktop` — `electron-vite build` + `electron-builder` for the host OS (`asarUnpack: ["**/node_modules/playwright-core/**"]`).
- `.github/workflows/release.yml` — on a `v*` tag, builds the universal macOS `dmg` and the Windows `nsis` installer on GitHub runners and attaches both to the Release. Unsigned on purpose: `electron-builder ... -c.mac.identity=-` ad-hoc signs the mac app so macOS shows the "unidentified developer" dialog instead of "damaged".

`@tiktok-uploader/core` is a **dev** dependency of `packages/desktop`: `electron.vite.config.ts` aliases it to `packages/core/src` and bundles it into `out/main`, so it must not be a runtime dependency or `electron-builder` tries to package the workspace symlink and fails with `<core>/dist/*.js must be under packages/desktop/`.

---

## 16. Phases

**P0 — Monorepo & Core Migration.**
Create npm workspaces (`core`, `cli`, `desktop`). Move existing `selectors.ts`, `cookies.ts`, `schedule.ts`, and `uploader/*` into `packages/core`. Fix `SUPPORTED_VIDEO_TYPES`. Switch `browser.ts` to `launchPersistentContext`, auto-detected Chromium, native UA, and `headless: true` default. Remove `chromeCookies.ts`. Add `profiles.ts` (multi-account + PID locks), `buildStaggeredSchedule`, persisted `queue.ts`, fail-fast captcha detection, and failure screenshot capture in `upload.ts`.
*Exit:* `npm run typecheck` and `packages/core` Vitest suite green.

**P1 — CLI (`packages/cli`).**
Implement `accounts`, `login`, `auth status`, `cookies`, `upload` (with `--start`, `--every`, `--jitter`, `--window`, `--headed`, `--dry-run`, `--json`), `queue`, and `doctor` with exit codes `0`–`6`.
*Exit:* End-to-end terminal test against a real account: `login` → headless draft upload → headless scheduled upload → verify `queue.json`, NDJSON stream, exit codes, and a forced-failure screenshot.

**P2 — Desktop Backend (`packages/desktop` main + preload).**
Wire `ipc.ts` (`powerSaveBlocker`, dialogs, core bridge), `index.ts`, and `preload/`.
*Exit:* DevTools IPC check sees the exact account authenticated via CLI in P1, runs a headless draft, and respects `account.lock`.

**P3 — Desktop UI (`packages/desktop` renderer).**
Build account switcher, queue table with per-row editors, Bulk Schedule modal, Pre-Run Confirmation modal, Show browser toggle, Retry Failed, settings panel, and copyable log drawer with clickable screenshot paths.
*Exit:* Full mouse-only flow: switch account → drop folder → bulk stagger → tweak one row → confirm → run headless → quit/reopen and verify queue persisted.

**P4 — Hardening & Packaging.**
Verify `tiktok-up doctor` selector health check, test `asarUnpack` in packaged `dmg`/`nsis`/`AppImage` builds, cross-platform smoke checks, and write `README.md` (install, multi-account setup, cron examples, troubleshooting).
*Exit:* Packaged desktop app and linked CLI both pass the smoke checklist cleanly.

**P5 — Distribution.**
GitHub Actions release workflow (macOS dmg + Windows nsis on tag). Remaining: paid signing/notarization, auto-update, Linux packages.

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| TikTok DOM changes | Headless uploads fail silently | Single `selectors.ts`; failure screenshots from P0/P1; `tiktok-up doctor`; `--headed` / Show browser |
| Captcha/challenge during headless run | Batch stalls or fails | Fail-fast detection → exit code `3` with prompt to retry headed |
| Cron job collides with open UI on same account | Profile corruption | `account.lock` PID file → clean exit code `4` / UI lock badge |
| Long headless batch with laptop lid closed | Upload aborted | `powerSaveBlocker` in UI; persisted `queue.json` + Retry Failed |
| Account schedule cap varies (10 vs 30 days) | Calendar date disabled | Configurable `maxScheduleDays` (default 10) + DOM disabled-date check |
| `playwright-core` inside Electron `asar` | Packaged launch failure | `asarUnpack` verified in P4 packaged build |

---

## 18. Locked-in decisions

1. **Architecture:** Shared TypeScript core (`packages/core`) powering both the Electron UI (`packages/desktop`) and Node CLI (`packages/cli`).
2. **User-Agent:** Native UA of the installed Chromium browser (Chrome-58 spoof removed).
3. **Headless default:** Headless by default across UI and CLI; headed on demand (`--headed` / **Show browser** toggle); login always headed. Failure screenshots enabled from P0/P1.
4. **Auth:** Persistent Playwright browser profile primary, `cookies.txt` import/export fallback; live Chrome profile copying dropped.
5. **Queue & Accounts:** Persisted `queue.json` and multi-account profiles (`profiles/<accountId>/`) included in v1, guarded by per-account PID lockfiles.

---

## 19. Definition of done (v1)

- On macOS, Windows, and Linux: install desktop app and CLI; add two accounts; sign in via either UI or `tiktok-up login` and see both share the same session.
- **UI:** Drop a folder, bulk-stagger schedules, adjust one row manually, confirm, run headless, save a draft, post/schedule a video, retry a failed row after restart, and inspect a failure screenshot.
- **CLI:** Run `tiktok-up upload --start ... --every ... --json` unattended in a cron-like shell; verify NDJSON output, deterministic exit codes (`0`, `3`, `4`, `5`), and lock safety against the UI.
- `npm run typecheck` and `npm test` pass across all workspaces; zero Python required at runtime.