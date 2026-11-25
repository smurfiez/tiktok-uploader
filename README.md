# TikTok Uploader

Upload and schedule TikTok videos from a desktop app or a scriptable CLI. One
shared TypeScript engine, your own Chrome/Edge/Brave profile, no Python, no
TikTok API keys, no proxy setup.

- **Desktop app** — drop a folder of videos, review captions, bulk-stagger
  schedules, press Run, watch the queue.
- **CLI (`tiktok-up`)** — the same engine for unattended cron jobs, with NDJSON
  output and deterministic exit codes.
- **Multi-account** — one isolated browser profile per account; a login in
  either interface is a login in both.

## Requirements

- Node.js 20+
- macOS, Windows or Linux
- Chrome, Edge or Brave installed (the app drives your real browser; no bundled
  Chromium download). Point `CHROME_PATH` at a binary if it cannot find one.

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
shows the account as **Signed in**.

### Migrating an existing session

```bash
tiktok-up cookies import cookies.txt --account main   # legacy Netscape file
tiktok-up cookies export /tmp/main-cookies.txt --account main
```

`cookies.txt` is injected into the profile on the first headless run if the
profile has no session. It is written with `0600` permission on POSIX.

## Desktop app

1. Pick the account, press **Sign In** if the chip says Expired.
2. **Add videos** / **Add folder**, or drag files onto the window.
3. Review each caption (or press **Generate** with an API key set), pick
   visibility, toggle Draft / AI label / Comment / Duet / Stitch.
4. **Bulk Schedule** — start time, interval (`12h`, `1d`), optional jitter
   (`15m`), optional allowed window (`09:00-21:00`), preview, Apply.
   Each row can still be tweaked by hand afterwards.
5. **Run** — the confirmation modal shows account, count, schedule span and how
   many captions are empty. Batches run headless unless **Show browser** is on.
6. Watch the log drawer; failures link straight to a screenshot.

Quitting mid-batch is safe: every row and status is persisted in
`profiles/<accountId>/queue.json`, so **Retry Failed** resumes after a restart.

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

# a draft (mutually exclusive with scheduling)
tiktok-up upload ./clip.mp4 --account main --draft --ai-label

# machine-readable, for cron
tiktok-up upload ./clips --account main --start "2026-12-01 18:00" --every 1d --json
```

Captions can come from a sidecar file (`clip.txt` next to `clip.mp4`), be passed
in the UI, or be generated with `--auto-caption` (needs `MODEL_ACCESS_KEY`).

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

Checks the data directory, that a browser launches, that the session is valid,
and that the upload form's root selector still exists. Run this first when a
TikTok DOM change breaks uploads.

### Cron

```cron
30 3 * * * MODEL_ACCESS_KEY=sk-... tiktok-up upload /srv/tiktok/inbox --account main --start "tomorrow 18:00" --every 1d --json >> /var/log/tiktok.jsonl 2>> /var/log/tiktok.err
```

`MODEL_ACCESS_KEY` always takes precedence over a key stored in the desktop app,
so unattended runs do not need the keychain.

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
| Scheduled slot rejected | Must be 5-minute aligned, 20+ minutes ahead, within `maxScheduleDays` (10, or 30 for Studio) |

## Development

```bash
npm test            # unit tests (no browser, no network)
npm run typecheck   # core, cli, desktop
```

Layout and invariants are in `CLAUDE.md`; the full spec is `PLAN.md`.

## License

MIT
