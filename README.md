# TikTok Uploader

Upload and schedule TikTok videos from a desktop app or a scriptable CLI. One
shared TypeScript engine, your own Chrome/Edge/Brave profile, no Python, no
TikTok API keys, no proxy setup.

- **Desktop app** — accounts sidebar, drop in videos or folders, review captions,
  bulk-stagger schedules, run one account or all ready ones, and browse what is
  already on TikTok.
- **CLI (`tiktok-up`)** — the same engine for unattended cron jobs, with NDJSON
  output and deterministic exit codes.
- **Multi-account** — one isolated browser profile per account; a login in
  either interface is a login in both. Accounts can run in parallel.

## Requirements

- Node.js 20+ for the CLI and for building from source
- macOS, Windows or Linux
- Chrome, Edge or Brave installed (the app drives your real browser; no bundled
  Chromium download). Browsers are discovered in this order: `CHROME_PATH`,
  the browser path in Settings, Brave, Chrome, Edge.

## Install

**macOS / Windows:** download the latest `.dmg` or `Setup .exe` from
[Releases](https://github.com/smurfiez/tiktok-uploader/releases). The builds are
unsigned, so each OS warns once:

- **macOS** — first launch: right-click the app → **Open** → **Open**. If macOS
  says the app is damaged (it was quarantined by the browser), run
  `xattr -dr com.apple.quarantine "/Applications/TikTok Uploader.app"` once.
- **Windows** — SmartScreen: **More info** → **Run anyway**.

From source:

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

The sidebar lists **All Accounts** and every account with a status dot and
counts. Press **Add Account** to create one, or drop videos straight onto an
account to queue them there. Each account can be signed in, deleted, and given
cookies from the sidebar bottom.

**Account Settings** (Edit) holds the display label, group tag, colour accent,
a linked source folder (with per-account subfolder recursion), and per-account
defaults for visibility, AI label, schedule horizon and bulk-schedule values.

**All Accounts overview** shows KPI cards, group filters, session state and each
queue's next slot. **Check All Sessions** re-verifies logins; **Run All Ready**
starts every signed-in account with pending work. The number of accounts running
at once is capped in Settings (default 2).

Per account, the workspace has three tabs:

- **Queue** — add videos, add a folder, toggle **Subfolders**, rescan the linked
  folder, and review rows. Each row takes a caption from its `<video>.txt`
  sidecar, a schedule, visibility, and Draft / AI label / Comment / Duet /
  Stitch. **Copy to Accounts** copies a row to other accounts; **Bulk Schedule**
  fills start time, interval (`12h`, `1d`), optional jitter (`15m`) and window
  (`09:00-21:00`) with a live preview. Drafts and private rows are skipped.
- **Completed** — finished uploads, with requeue, remove, and clear all.
- **TikTok Library** — syncs published, scheduled, draft and private videos from
  TikTok Studio, then filters and searches them with views, likes and comments.
  Each card opens on TikTok.

**Run** asks for confirmation (account, count, schedule span, empty captions).
Batches run headless unless **Show browser** is on; **Stop** ends after the
in-flight job. The log drawer records events, and failures link straight to a
screenshot. `Cmd/Ctrl+0` opens the overview, `Cmd/Ctrl+1…9` picks a sidebar
account.

Quitting mid-batch is safe: every row and status is persisted in
`profiles/<accountId>/queue.json`, so **Retry Failed** resumes after a restart.

Cookies can be imported without a browser window: paste a `sessionid`, a JSON
export, or a Netscape `.txt`, or import a file. Imports are verified before they
replace a working session, and stored with `0600` permissions. **Export** writes
the current cookies to a file.

**Settings** holds the theme, headless default, browser path, schedule horizon
(10 days, or 30 for TikTok Studio), subfolder default, max parallel accounts,
default visibility and default AI label.

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
videos; `-r` / `--recursive` includes subfolders) and accepts
`--visibility everyone|friends|private`, `--ai-label` / `--no-ai-label`,
`--max-schedule-days <days>`, `--headed`, `--dry-run` and `--json`. `--start`
and `--every` must be used together.

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
    library.json                # latest TikTok Studio sync
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
