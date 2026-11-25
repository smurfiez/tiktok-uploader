# TikTok Uploader

Upload and schedule TikTok videos from a desktop app or a scriptable CLI. One
shared TypeScript engine, your own Chrome/Edge/Brave profile, no Python, no
TikTok API keys, no proxy setup.

- **Desktop app** — drop in videos or a folder, review captions, bulk-stagger
  schedules, press Run, watch the queue.
- **CLI (`tiktok-up`)** — the same engine for unattended cron jobs, with NDJSON
  output and deterministic exit codes.
- **Multi-account** — one isolated browser profile per account; a login in
  either interface is a login in both.

## Requirements

- Node.js 20+ for the CLI and for building from source
- macOS, Windows or Linux
- Chrome, Edge or Brave installed (the app drives your real browser; no bundled
  Chromium download). Browsers are discovered in this order: `CHROME_PATH`,
  the browser path in Settings, Brave, Chrome, Edge.

## Install

```bash
git clone https://github.com/smurfiez/tiktok-uploader.git
cd tiktok-uploader
npm install

# CLI
npm run build:cli
npm link packages/cli        # puts `tiktok-up` on PATH

# Desktop (dev)
npm run dev:desktop

# Desktop (installer for the host OS)
npm run dist:desktop         # dmg / nsis / AppImage + deb in packages/desktop/release
```

## First run

```bash
tiktok-up accounts add main --label "Brand Main"
tiktok-up login --account main     # opens a real browser window; sign in there
tiktok-up auth status --account main
```

The login persists in the account's browser profile, so later headless runs
reuse it. The desktop app reads the same profile: after the command above it
shows the account as signed in.

### Account management

```bash
tiktok-up accounts list                    # add --json for NDJSON
tiktok-up accounts label main "Brand Main" # display label; the id stays
tiktok-up accounts remove old
```

### Migrating an existing session

```bash
tiktok-up cookies import cookies.txt --account main   # legacy Netscape file
tiktok-up cookies export /tmp/main-cookies.txt --account main
```

`cookies.txt` is injected into the profile on the first headless run if the
profile has no session. It is written with `0600` permission on POSIX.

## Desktop app

1. Pick or **Add Account** in the toolbar, press **Sign In** if the chip says
   Expired, and use **Edit Label** to rename the display label.
2. **Add videos** / **Add folder**, or drag files or a folder onto the window.
3. Review each caption, pick
   visibility, and toggle Draft / AI label / Comment / Duet / Stitch.
4. **Bulk Schedule** — start time, interval (`12h`, `1d`), optional jitter
   (`15m`), optional allowed window (`09:00-21:00`), preview, Apply. Drafts and
   private rows are skipped. Each row can still be tweaked by hand afterwards.
5. **Run** — the confirmation modal shows account, count, schedule span and how
   many captions are empty. Batches run headless unless **Show browser** is on.
6. Watch the log drawer (**Copy** copies it); failures link straight to a
   screenshot. **Stop** ends the batch after the in-flight job.

Quitting mid-batch is safe: every row and status is persisted in
`profiles/<accountId>/queue.json`, so **Retry Failed** resumes after a restart.
**Clear** removes finished rows.

The **Settings** dialog holds the browser path, schedule horizon (10 days, or
30 for TikTok Studio), and the default visibility.

## CLI

```bash
# what would happen
tiktok-up upload ./clips --account main \
  --start "tomorrow 18:00" --every 12h --jitter 15m --window "09:00-21:00" \
  --dry-run

# real, headless, one scheduled post every 12 hours
tiktok-up upload ./clips --account main \
  --start "tomorrow 18:00" --every 12h --jitter 15m --window "09:00-21:00"

# one video, posted now, browser visible
tiktok-up upload ./clip.mp4 --account main --headed

# a draft (drafts cannot be scheduled)
tiktok-up upload ./clip.mp4 --account main --draft --ai-label

# machine-readable, for cron
tiktok-up upload ./clips --account main --start "2026-12-01 18:00" --every 1d --json
```

`upload` takes files and/or directories (directories are scanned for supported
videos) and accepts `--visibility everyone|friends|private`,
`--ai-label` / `--no-ai-label`, `--max-schedule-days <days>`, `--headed`,
`--dry-run` and `--json`. `--start` and `--every` must be used together.

Captions come from a sidecar file (`clip.txt` next to `clip.mp4`), or from
the filename without its render prefix.

### Queue recovery

```bash
tiktok-up queue status --account main
tiktok-up queue retry-failed --account main --headed
tiktok-up queue clear --account main --completed-only
```

### Diagnostics

```bash
tiktok-up doctor --account main
```

Checks the data directory, that the browser launches, that the session is valid,
and that the upload page's root selector still exists. Run this first when a
TikTok DOM change breaks uploads.

### Cron

```cron
30 3 * * * tiktok-up upload /srv/tiktok/inbox --account main --start "tomorrow 18:00" --every 1d --json >> /var/log/tiktok.jsonl 2>> /var/log/tiktok.err
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | All jobs succeeded (or dry run passed) |
| 1 | Unexpected runtime error |
| 2 | Invalid arguments, missing files, schedule or caption validation |
| 3 | Not signed in, session expired, or a captcha challenge |
| 4 | Account locked by another process (CLI vs desktop) |
| 5 | Partial failure (some succeeded, some failed) |
| 6 | All jobs failed |

## Scheduling rules

- Slots sit on a 5-minute grid and must be at least 20 minutes ahead.
- The horizon is `maxScheduleDays`: 10 by default, 30 for TikTok Studio.
- Drafts and private (`Only me`) uploads cannot be scheduled.
- Jitter is a random offset per slot; a window restricts posting to those hours.

## Where data lives

```
<dataDir>/                      # TIKTOK_UPLOADER_HOME overrides
  settings.json
  accounts.json
  profiles/<accountId>/
    browser-profile/            # persistent Playwright profile
    cookies.txt                 # optional Netscape fallback
    queue.json                  # persisted rows and statuses
    account.lock                # PID lockfile, reclaimed when stale
    failures/                   # full-page screenshots of failed jobs
```

- macOS `~/Library/Application Support/tiktok-uploader`
- Windows `%APPDATA%\tiktok-uploader`
- Linux `$XDG_CONFIG_HOME/tiktok-uploader` (or `~/.config/tiktok-uploader`)

Two processes cannot drive the same browser profile. If cron and the desktop app
target the same account, the second one exits with code `4` (or shows a "Locked
by CLI" chip) instead of corrupting the profile. Different accounts run in
parallel.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not start a Chromium browser" | Install Chrome/Edge/Brave or set `CHROME_PATH` |
| Exit code 3 / "Captcha challenge detected" | Run `tiktok-up login --account <id>` or retry with `--headed` and solve it once |
| Exit code 4 / Locked by CLI | Another run owns the profile; wait or stop it |
| Upload fails at a selector | Run `tiktok-up doctor`; TikTok changed its DOM — fix `packages/core/src/selectors.ts` |
| Scheduled slot rejected | Must be 5-minute aligned, 20+ minutes ahead, within the schedule horizon |

## Development

```bash
npm test                                          # Vitest, no browser or network
npx vitest run packages/core/tests/schedule.test.ts  # a single file
npm run typecheck                                 # core, cli, desktop
npm run build:cli                                 # build core first, then the bin
```

Layout and invariants are in `AGENTS.md`; the full spec is `docs/PLAN.md`.

## Built with

Standing on other people's work; thank you all.

- [playwright-core](https://playwright.dev) (Microsoft, Apache-2.0) — drives your
  installed browser; no bundled Chromium.
- [commander](https://github.com/tj/commander.js) (MIT) — the `tiktok-up` CLI.
- [Electron](https://www.electronjs.org) (MIT), [electron-vite](https://electron-vite.org)
  and [electron-builder](https://www.electron.build) (MIT) — the desktop app and installers.
- [React](https://react.dev) (MIT) and [Vite](https://vite.dev) (MIT) — the renderer UI.
- [TypeScript](https://www.typescriptlang.org) (Apache-2.0) and [Vitest](https://vitest.dev)
  (MIT) — compiler and tests.

## Credits & License

MIT. A TypeScript fork of
[wkaisertexas/tiktok-uploader](https://github.com/wkaisertexas/tiktok-uploader),
whose Python implementation this project's design and TikTok selectors descend
from.
