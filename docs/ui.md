# Comprehensive Handoff Specification: Review Fixes, Recursive Uploads, Queue/Completed Split, TikTok Library & Multi-Account Management

> **Handoff Note**: This is a complete, self-contained engineering specification written so any developer or AI assistant can implement every phase cleanly with zero guesswork. Follow every file path, TypeScript type, IPC signature, CSS rule, edge case, and verification step strictly.
>
> **Baseline**: Commit `eb8673b` implemented the two-pane desktop shell, Light/Dark/System themes, Chrome cookie import, and label-only accounts. All 111 Vitest tests, `npm run typecheck`, `npm run build:cli`, and `npm run build -w @tiktok-uploader/desktop` currently pass.

---

## 0. Hard Invariants & Rules (Read First)

1. **Code Style (`AGENTS.md`)**: TypeScript, **no semicolons**, **single quotes**, **2-space indentation**.
2. **Zero Electron in Core**: `packages/core` must NEVER import `electron`.
3. **Single Core Entrypoint**: Desktop and CLI must ONLY import from `'@tiktok-uploader/core'` (exported via `packages/core/src/index.ts`). No deep imports.
4. **Optional Fields on `Settings` & `Account`**: Any new fields added to `Settings` or `Account` MUST be optional (`?`) on the TypeScript interface (while populated in `DEFAULT_SETTINGS` where applicable) so existing tests (like `packages/core/tests/queue.test.ts` constructing raw `Settings` literals) and existing `settings.json` / `accounts.json` files stay 100% compatible.
5. **Single Selector File**: Every TikTok URL and Playwright selector MUST live in `packages/core/src/selectors.ts`.
6. **Strict CSP Preserved**: Keep `img-src 'self' data:` in `index.html` and `main/index.ts`. Never weaken CSP for external TikTok CDN thumbnails — fetch thumbnails in Node/Playwright and store them as `data:image/...;base64,...` data URIs.
7. **IPC Sync**: Every IPC change updates ALL THREE files together:
   - `packages/desktop/src/main/ipc.ts`
   - `packages/desktop/src/preload/index.ts`
   - `packages/desktop/src/preload/index.d.ts`
8. **UI Polish Rules**:
   - NEVER use `window.confirm()` or `window.alert()`.
   - NEVER display raw `account.id` or `job.id` anywhere in the UI, dialogs, or activity log.
   - NEVER hardcode dark hex colors in component CSS — use CSS custom properties from both `[data-theme='dark']` and `[data-theme='light']`.
   - Use crisp `1.75px`-stroke SVG icons from `components/Icons.tsx` (never raw Unicode symbols like `✕`, `▾`, `▸`).
   - Use `ToggleSwitch` for boolean settings and `.option-pill` buttons (`aria-pressed`) for video/toolbar toggles.

---

## 1. Part A — Review Follow-Up Fixes (Fix Existing Bugs & Polish First)

### A.1 Fix Failed Cookie Import Clobbering `cookies.txt` & `signedIn` Cache
- **Files**: `packages/core/src/types.ts`, `packages/core/src/uploader/auth.ts`, `packages/desktop/src/main/ipc.ts`
- **Bug**: `applyImportedCookies()` restores previous browser cookies when verification fails, but `saveAndVerifyCookies()` in `ipc.ts` writes `cookies.txt` *before* verifying and unconditionally sets `signedIn.set(accountId, status.signedIn)`.
- **Exact Fix**:
  1. In `packages/core/src/types.ts`, add `restored?: boolean` to `AuthStatus`:
     ```ts
     export interface AuthStatus {
       signedIn: boolean
       message: string
       /** The profile is in use by another run, so the session could not be checked */
       locked?: boolean
       /** True when a failed cookie import restored the previous browser session */
       restored?: boolean
     }
     ```
  2. In `packages/core/src/uploader/auth.ts` inside `applyImportedCookies()` return object (around line 274), add `...(restored ? { restored: true } : {})`.
  3. In `packages/desktop/src/main/ipc.ts` inside `saveAndVerifyCookies()`, call `applyImportedCookies()` FIRST; only write `cookies.txt` and mark signed-in when `status.signedIn` is `true`, and do NOT overwrite a previously working `signedIn` state when `status.restored` or `status.locked` is `true`:
     ```ts
     const status = await applyImportedCookies(accountId, cookies, {
       browserPath: loadSettings().browserPath,
       source: 'desktop'
     })

     if (status.signedIn) {
       const target = cookiesPath(accountId)
       await mkdir(dirname(target), { recursive: true, mode: 0o700 })
       await writeFile(target, serializeNetscape(cookies), { encoding: 'utf8', mode: 0o600 })
       if (process.platform !== 'win32') chmodSync(target, 0o600)
       signedIn.set(accountId, true)
       updateAccount(accountId, { lastSignedIn: true, lastCheckedAt: new Date().toISOString() })
     } else if (!status.restored && !status.locked) {
       signedIn.set(accountId, false)
       updateAccount(accountId, { lastSignedIn: false, lastCheckedAt: new Date().toISOString() })
     }

     return {
       ok: status.signedIn,
       signedIn: status.signedIn,
       count: cookies.length,
       message: status.message
     }
     ```

### A.2 Fix Schedule Clear (`✕`) Overlapping Native Calendar Picker
- **Files**: `packages/desktop/src/renderer/src/components/JobRow.tsx` (lines 87–104), `packages/desktop/src/renderer/src/styles.css` (lines 764–785)
- **Bug**: `.clear-btn` is `position: absolute; top: 15px; right: 12px;`, sitting directly over Chromium's calendar icon inside `<input type="datetime-local">`.
- **Exact Fix**:
  1. Wrap the input and button inside `<div className="schedule-input-wrap">`:
     ```tsx
     <div className="schedule-input-wrap">
       <input
         type="datetime-local"
         className="datetime-input"
         value={isoToLocal(job.schedule)}
         disabled={scheduleDisabled}
         aria-label={`Schedule for ${name}`}
         title={scheduleDisabled ? disabledReason : undefined}
         onChange={(e) => onChange({ schedule: localToIso(e.target.value) })}
       />
       {job.schedule && !scheduleDisabled ? (
         <button
           type="button"
           className="clear-btn"
           title="Clear schedule (post now)"
           aria-label="Clear schedule"
           onClick={() => onChange({ schedule: null })}
         >
           <CloseIcon size={12} />
         </button>
       ) : null}
     </div>
     ```
  2. Replace `.clear-btn` absolute CSS with flex layout:
     ```css
     .schedule-input-wrap {
       display: flex;
       align-items: center;
       gap: 4px;
     }
     .schedule-cell .datetime-input {
       flex: 1 1 auto;
       min-width: 0;
       width: 100%;
       height: 28px;
       padding: 0 6px 0 8px;
       font-size: 11.5px;
       font-variant-numeric: tabular-nums;
     }
     .clear-btn {
       flex: 0 0 auto;
       width: 24px;
       height: 24px;
       border-radius: var(--radius-sm);
     }
     ```

### A.3 Fix `.remove-btn:hover` Red Hover Overridden by Later CSS
- **File**: `packages/desktop/src/renderer/src/styles.css` (lines 956–960 vs lines 1627–1634)
- **Exact Fix**: Remove `.remove-btn:hover:not(:disabled)` from the shared neutral hover selector at line 1628 so the red danger hover rule (`background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger-text);`) wins.

### A.4 Stop Leaking Internal `accountId` Into the Activity Log
- **File**: `packages/desktop/src/renderer/src/App.tsx` (line 211)
- **Exact Fix**: Sanitize CLI hints before logging:
  ```ts
  if (!status.signedIn) {
    const clean = /tiktok-up login/i.test(status.message)
      ? 'Not signed in — click Sign In or Import Chrome Cookies'
      : status.message
    addLog(`${labelOf(accountId)}: ${clean}`, 'error')
  }
  ```

### A.5 Polish Fixes Bundle
Apply all of the following while editing the corresponding components/CSS:
1. **Sidebar account label truncation (`App.tsx` line 634)**: Wrap `{label}` inside `<span className="account-name">{label}</span>` so `.account-item > *:not(.status-dot)` applies `text-overflow: ellipsis`.
2. **Queue table width (`styles.css` lines 573–627)**: Reduce `.queue-table { min-width: 700px; }` and tighten column widths (Video `152px`, Caption `auto`, Schedule `172px`, Settings `204px`, Status `118px`) so the table fits without horizontal scrolling on normal desktop widths.
3. **Balanced Sidebar `.account-actions` (`App.tsx` & `styles.css`)**: Replace the 5-button 2-col grid (which leaves an orphan 5th button) with 2 rows:
   - Row 1 (`.account-actions-primary`, `grid-template-columns: 1fr 1fr`): **Sign In** and **Cookies** (`title="Import Chrome Cookies"`).
   - Row 2 (`.account-actions-secondary`, `grid-template-columns: repeat(3, 1fr)`): **Export**, **Edit** (opens `AccountSettingsModal`), **Delete** (`btn ghost sm` / `btn danger sm`).
4. **Sidebar `+` button (`App.tsx` line 619)**: Change `className="btn ghost sm"` → `className="icon-btn"`.
5. **Empty state layout & clickable connect links (`App.tsx` lines 793–809)**:
   - Wrap `Add Videos` (`btn primary`) and `Add Folder` (`btn`) side-by-side inside `<div className="empty-actions">`.
   - Make `"Need to connect this account? Sign In or Import Chrome Cookies"` real clickable `.text-link` buttons.
6. **`Show browser` alignment (`App.tsx` line 714)**: Replace `<label className="hint" style={...}>` with `<label className="header-toggle">` (`margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); cursor: pointer;`).
7. **`JobRow` badges & spacing (`JobRow.tsx` lines 78–84, 139–153)**:
   - Render `length > HARD_LIMIT ? <error> : length > SOFT_LIMIT ? <warn> : null` (never BOTH badges simultaneously).
   - Add `margin-top: 5px;` to `.caption-meta`.
   - Render `.screenshot-link` on its own line (`display: block; margin-top: 4px;`).
8. **`ImportCookiesModal` empty badge (`ImportCookiesModal.tsx` lines 162–165)**:
   - When `!raw.trim()`, display `<span className="badge">Auto-detect</span>` instead of `"Unknown format"`.
   - When `raw.trim()`, display `<span className={format ? 'badge ok' : 'badge warn'}>{format ?? 'Unrecognized format'}</span>`.
9. **Activity Log header click (`styles.css` line 1045 & `App.tsx` line 840)**: Remove `cursor: pointer` from `.log-header` (or make the entire header toggle while calling `e.stopPropagation()` on `Clear` and `Copy`).
10. **Toasts, progress bar, BulkModal & OS theme listener**:
    - Call `pushToast(...)` in `applyBulk` and `clearFinished`.
    - Sync `accountsRef.current = list` immediately alongside `setAccounts(list)`.
    - In `BulkModal.tsx` line 95, use `aria-pressed={every.trim() === preset}`.
    - In `main/index.ts`, subscribe to `nativeTheme.on('updated', ...)` so if `loadSettings().theme === 'system'` and OS theme changes while open, `window?.setBackgroundColor(resolveBg('system'))` updates automatically.
    - When `running` is true for the active account and `completed > 0`, show determinate width on `.run-progress-fill` (`style={{ width: `${pct}%`, animation: 'none' }}`) instead of infinite sweep.

---

## 2. Part B — Recursive Folder Upload Option

### B.1 Core (`packages/core/src/videos.ts`)
Replace `listVideos` with recursive-capable implementation (default `recursive: false` preserves all existing behavior):

```ts
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export interface ListVideosOptions {
  recursive?: boolean
}

/** Supported videos inside `directory` (direct children by default; set `recursive: true` for subfolders). */
export function listVideos(directory: string, options: ListVideosOptions = {}): VideoItem[] {
  const recursive = Boolean(options.recursive)
  const items: VideoItem[] = []
  const visited = new Set<string>()

  const walk = (dir: string): void => {
    let real: string
    try {
      real = realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (recursive) walk(fullPath)
        continue
      }

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath)
          if (stats.isDirectory()) {
            if (recursive) walk(fullPath)
            continue
          }
          if (stats.isFile() && isSupportedVideo(entry.name) && stats.size > 0) {
            items.push({
              path: fullPath,
              title: filenameTitle(fullPath),
              size: stats.size,
              mtimeMs: stats.mtimeMs
            })
          }
        } catch {
          // broken symlink or unreadable target
        }
        continue
      }

      if (!entry.isFile() || !isSupportedVideo(entry.name)) continue
      try {
        const stats = statSync(fullPath)
        if (stats.size > 0) {
          items.push({
            path: fullPath,
            title: filenameTitle(fullPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs
          })
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  walk(directory)
  return items.sort((a, b) => a.path.localeCompare(b.path))
}
```

### B.2 Settings (`packages/core/src/types.ts`, `packages/core/src/settings.ts`)
- Add `recursiveFolder?: boolean` to `Settings` interface.
- Add `recursiveFolder: false` to `DEFAULT_SETTINGS`.

### B.3 CLI (`packages/cli/src/index.ts`)
- Add `recursive?: boolean` to `UploadOptions`.
- Update `expandPaths(args: string[], recursive = false): string[]` to call `listVideos(path, { recursive })`.
- Add `.option('-r, --recursive', 'include videos in subfolders')` to the `upload` command and pass `Boolean(options.recursive)` to `expandPaths(paths, Boolean(options.recursive))`.

### B.4 Desktop IPC, Preload & UI
- **`packages/desktop/src/main/ipc.ts`**:
  ```ts
  ipcMain.handle(
    'videos:list',
    (_event, directory: string, options?: { recursive?: boolean }) =>
      listVideos(directory, options)
  )
  ```
- **`packages/desktop/src/preload/index.ts` & `index.d.ts`**:
  ```ts
  videos: {
    pick(): Promise<string[]>
    pickFolder(): Promise<string | null>
    list(directory: string, options?: { recursive?: boolean }): Promise<VideoItem[]>
  }
  ```
- **Desktop UI**:
  - Compute effective recursive mode for the active account:
    `const recursiveFolder = currentAccount?.recursiveFolder ?? settings.recursiveFolder ?? false`
  - Add a compact `.option-pill` button right next to **Add Folder** in the Queue sub-toolbar:
    ```tsx
    <button
      type="button"
      className="option-pill"
      aria-pressed={recursiveFolder}
      title="Include videos inside nested subfolders when adding or dropping folders"
      onClick={() => void toggleRecursiveFolder()}
    >
      {recursiveFolder ? <CheckIcon size={12} /> : null}
      Subfolders
    </button>
    ```
    Clicking it saves `{ recursiveFolder: !recursiveFolder }` to `settings` (or updates the active account's override if set).
  - Pass `{ recursive: recursiveFolder }` in `addFolder()`, `handleDrop()`, `scanLinkedFolder()`, and sidebar-account drops!
  - Also add **Include subfolders by default** (`ToggleSwitch`) in `SettingsModal.tsx`.

---

## 3. Part C — Separate Queue vs. Completed Views & Fix Bulk Schedule Scope

### C.1 Workspace 3-Tab Navigation (`App.tsx`, `styles.css`)
When viewing an individual account (not the All Accounts Overview), render a crisp workspace tab bar directly under `.workspace-header`:
```text
[ Queue (4) ]   [ Completed (12) ]   [ TikTok Library (28) ]
```
- State: `const [workspaceTab, setWorkspaceTab] = useState<'queue' | 'completed' | 'library'>('queue')`.
- Tab count badges:
  - **Queue**: `activeJobs.length`
  - **Completed**: `completedJobs.length`
  - **TikTok Library**: `library?.items.length ?? 0` (omit badge if never synced yet)

### C.2 Strict Job Scoping Rules (Fixes Bulk Schedule Overwriting Completed Rows!)
Define explicit derived arrays in `App.tsx`:
```ts
const isActiveJob = (job: Job): boolean =>
  job.status === 'pending' || job.status === 'running' || job.status === 'failed'

const isRunnableJob = (job: Job): boolean =>
  job.status === 'pending' || job.status === 'failed'

const activeJobs = useMemo(() => jobs.filter(isActiveJob), [jobs])
const runnableJobs = useMemo(() => jobs.filter(isRunnableJob), [jobs])
const completedJobs = useMemo(
  () => jobs.filter((job) => job.status === 'done' || job.status === 'skipped'),
  [jobs]
)
const schedulableCount = useMemo(
  () => runnableJobs.filter((job) => !job.draft && job.visibility !== 'private').length,
  [runnableJobs]
)
```

Enforce these 5 rules strictly:
1. **`applyBulk(timestamps)`**: ONLY schedules `isRunnableJob(job) && !job.draft && job.visibility !== 'private'`. **NEVER modifies `done`, `skipped`, or `running` rows:**
   ```ts
   function applyBulk(timestamps: string[]) {
     let index = 0
     commit(
       jobsRef.current.map((job): Job => {
         if (!isRunnableJob(job)) return job
         if (job.draft || job.visibility === 'private') return { ...job, schedule: null }
         const iso = timestamps[index++]
         return iso ? { ...job, schedule: iso } : job
       })
     )
     setBulkOpen(false)
     addLog(`Applied ${timestamps.length} schedule slot(s) to pending jobs`)
     pushToast(`Scheduled ${timestamps.length} video${timestamps.length === 1 ? '' : 's'}`, 'ok')
   }
   ```
   *(Note: If a row is already `done`, its historical `schedule` stays preserved untouched!)*
2. **Header `Run` button**:
   - Disabled when `!currentAccount || !runnableJobs.length || busy`.
   - Label: `Run (${runnableJobs.length})` when `runnableJobs.length > 0`, else `Run`.
3. **`ConfirmModal`**:
   - Pass `jobs={runnableJobs}` (NOT all `jobs`!) so counts, schedule span, empty captions, and hard-limit errors only evaluate videos that will actually be uploaded.
4. **Queue Tab**:
   - Shows ONLY `activeJobs` (`pending`, `running`, `failed`).
   - Empty state when `activeJobs.length === 0`: if `completedJobs.length > 0`, show *"All caught up — N completed video(s)"* with buttons to **Add Videos**, **Add Folder**, or **View Completed**.
   - Sub-toolbar buttons: `Add Videos`, `Add Folder`, `Subfolders` toggle pill, optional `Scan Linked Folder` (when `currentAccount.sourceFolder` is set), `Bulk Schedule`, `Retry Failed` (when `failedCount > 0`).
5. **Completed Tab (`components/CompletedRow.tsx`)**:
   - Shows ONLY `completedJobs` (`done`, `skipped`) in a clean read-only table:
     - **Video**: `FilmIcon` thumb + filename + `.ext` tag
     - **Caption**: clamped read-only preview (`2 lines`, full tooltip)
     - **Schedule**: `formatWhen(job.schedule)`
     - **Settings**: read-only visibility + active tag badges (`Draft`, `AI`)
     - **Status & Actions**: `Done`/`Skipped` pill + **Re-queue** button (`RefreshIcon`, resets `{ status: 'pending', error: undefined, screenshot: undefined }` and moves back to Queue with toast) + **Remove** button (`TrashIcon`).
   - Completed tab sub-toolbar shows `N completed` count + **Clear All Completed** button (`clearFinished()`).
   - Empty state when `completedJobs.length === 0`: *"No completed uploads yet"*.

---

## 4. Part D — In-App TikTok Library (View Existing TikTok Videos)

### D.1 Core Types & Paths (`packages/core/src/types.ts`, `packages/core/src/paths.ts`)
1. In `packages/core/src/types.ts`, add:
   ```ts
   export type RemoteVideoStatus =
     | 'published'
     | 'scheduled'
     | 'draft'
     | 'private'
     | 'processing'
     | 'unknown'

   export interface TikTokVideo {
     id: string
     caption: string
     /** Base64 data URI fetched in Playwright so renderer CSP stays `img-src 'self' data:` */
     thumbnailDataUrl?: string
     url: string
     status: RemoteVideoStatus
     visibility: Visibility | 'unknown'
     createdAt?: string
     scheduledAt?: string
     durationSec?: number
     views?: number
     likes?: number
     comments?: number
     shares?: number
   }

   export interface AccountLibrary {
     fetchedAt: string
     handle?: string
     items: TikTokVideo[]
   }
   ```
2. In `packages/core/src/paths.ts`, add:
   ```ts
   export const libraryPath = (id: string): string => join(accountDir(id), 'library.json')
   ```

### D.2 Selectors (`packages/core/src/selectors.ts`)
Add to `PATHS`:
```ts
export const PATHS = {
  main: 'https://www.tiktok.com/',
  login: 'https://www.tiktok.com/login',
  upload: 'https://www.tiktok.com/creator-center/upload?lang=en',
  content: 'https://www.tiktok.com/tiktokstudio/content'
} as const
```
Add `library` section to `SELECTORS`:
```ts
  library: {
    apiUrlPatterns: [
      '/api/post/item_list',
      '/aweme/v1/creator/item/list',
      '/tiktok/studio/api',
      '/item_list',
      '/item/list',
      '/creator/item'
    ],
    row: '[data-e2e="post-row"], [data-e2e="video-row"], table tbody tr, [class*="video-item"], [class*="post-item"]',
    videoLink: 'a[href*="/video/"]',
    thumbnail: 'img[src]'
  }
```

### D.3 Core Library Sync & Cache (`packages/core/src/uploader/library.ts`)
Create `packages/core/src/uploader/library.ts` (and export `loadLibrary`, `saveLibrary`, `parseCreatorApiPayload`, `syncAccountLibrary` from `packages/core/src/index.ts`):

#### 1. Disk Cache Helpers
- `loadLibrary(accountId: string): AccountLibrary | null`: reads `libraryPath(accountId)` safely (`try/catch` → `null`).
- `saveLibrary(accountId: string, library: AccountLibrary): void`: atomic `.tmp` + `renameSync` into `dirname(libraryPath(accountId))` with `mode: 0o700`.

#### 2. Pure API Payload Normalizer (`parseCreatorApiPayload`)
Export `export interface RawLibraryItem extends Omit<TikTokVideo, 'thumbnailDataUrl'> { coverUrl?: string }`.
`parseCreatorApiPayload(payload: unknown): { handle?: string; items: RawLibraryItem[] }`:
- Locate candidate item array from `payload` object (checking `itemList`, `items`, `aweme_list`, `item_info_list`, `video_list`, `list`, or nested `data.itemList` / `data.items` / `data.aweme_list` / `data.item_info_list` / `data.list`).
- If no array found, return `{ items: [] }`.
- For each object entry:
  - Extract `id`: `String(entry.id ?? entry.item_id ?? entry.itemId ?? entry.aweme_id ?? '')`. Skip if empty.
  - Extract `handle`: `entry.author?.uniqueId ?? entry.author?.unique_id ?? entry.uniqueId ?? entry.creator?.uniqueId`.
  - Extract `caption`: `String(entry.desc ?? entry.title ?? entry.caption ?? '').trim()`.
  - Extract `coverUrl`: `entry.video?.cover ?? entry.video?.originCover ?? entry.video?.dynamicCover ?? entry.cover_url ?? entry.coverUrl ?? entry.cover ?? entry.thumbnail`.
  - Extract timestamps:
    - `createRaw = Number(entry.createTime ?? entry.create_time ?? entry.post_time ?? 0)` → convert Unix seconds (`< 1e12 ? createRaw * 1000 : createRaw`) to ISO string if `> 0`.
    - `schedRaw = Number(entry.scheduleTime ?? entry.schedule_time ?? 0)` → convert to ISO string if `> 0`.
  - Determine `visibility`:
    - Check `entry.privateItem`, `entry.is_private`, `entry.visibility`, `entry.privacy_level`, `entry.status?.private_status`:
      - private / `2` / `SELF_ONLY` → `'private'`
      - friends / `1` / `MUTUAL_FOLLOW_FRIENDS` → `'friends'`
      - everyone / public / `0` / `PUBLIC_TO_EVERYONE` → `'everyone'`
      - fallback → `'unknown'`
  - Determine `status`:
    - If `scheduledAt` is set (and in future, or `entry.is_scheduled` / `entry.status === 'scheduled'` / `entry.status_type === 'scheduled'`) → `'scheduled'`
    - Else if `entry.is_draft` / `entry.status === 'draft'` → `'draft'`
    - Else if `visibility === 'private'` → `'private'`
    - Else if `entry.status === 'processing'` / `entry.is_processing` → `'processing'`
    - Else → `'published'`
  - Extract stats (check `entry.stats ?? entry.statistics ?? entry.metrics ?? entry`):
    - `views`: `playCount ?? play_count ?? view_count ?? views`
    - `likes`: `diggCount ?? digg_count ?? like_count ?? likes`
    - `comments`: `commentCount ?? comment_count ?? comments`
    - `shares`: `shareCount ?? share_count ?? shares`
  - Extract `durationSec`: `Number(entry.video?.duration ?? entry.duration ?? 0)` (if `> 10_000`, assume ms and divide by 1000; round to integer).
  - Build `url`: if `entry.share_url` / `entry.url` starts with `https://www.tiktok.com/`, use it; else if `handle`, `https://www.tiktok.com/@${handle}/video/${id}`; else `PATHS.content`.

#### 3. Playwright Sync (`syncAccountLibrary`)
```ts
export interface SyncLibraryResult {
  ok: boolean
  library?: AccountLibrary
  locked?: boolean
  message: string
}

export async function syncAccountLibrary(
  accountId: string,
  options: { browserPath?: string; source?: string; maxItems?: number } = {}
): Promise<SyncLibraryResult>
```
Step-by-step execution:
1. Acquire lock: `acquireLock(accountId, options.source ?? 'library-sync')`. Return `{ ok: false, locked: true, message }` on `LockBusyError`.
2. Launch headless context (`launchContext({ userDataDir: browserProfileDir(accountId), headless: true, browserPath: options.browserPath })`).
3. Wrap in `try / finally` (always `releaseLock(accountId)` and `closeBrowser(close)`).
4. Call `await ensureAuthenticated({ context, page, accountId, report: () => {} })`. If `AuthError`, return `{ ok: false, message: error.message }`.
5. Attach `page.on('response', ...)` listener BEFORE `page.goto`:
   - Check if `response.status() === 200`, `content-type` includes `json`, and URL matches any pattern in `SELECTORS.library.apiUrlPatterns`.
   - Parse JSON safely, run `parseCreatorApiPayload(json)`, collect `handle` and `RawLibraryItem`s into a `Map<string, RawLibraryItem>` (deduplicated by `id`).
6. Navigate to `PATHS.content` (`waitUntil: 'domcontentloaded'`).
7. Check `await assertSignedIn(page, 'TikTok Studio content')`.
8. Wait up to `12_000ms` (polling every `500ms`) until either `captured.size > 0` OR `await page.locator(SELECTORS.library.row).count() > 0` (also give 1.5s extra once the first API response arrives so secondary pages settle).
9. **DOM Fallback**: If `captured.size === 0`, run `page.evaluate(...)` using `SELECTORS.library` to scrape visible rows (`a[href*="/video/"]`, `img[src]`, row text) so even if TikTok renames API routes, basic video listing still works.
10. **Authenticated Thumbnail Fetch (CSP-Safe)**:
    - Slice deduplicated items to `maxItems` (default `40`).
    - Process in batches of `5` using `Promise.allSettled`:
      - For each item with `coverUrl` starting with `https://`:
        - `const res = await context.request.get(item.coverUrl, { timeout: 5_000 })`
        - If `res.ok()`: read `const buf = await res.body()`, skip if `buf.byteLength === 0 || buf.byteLength > 260_000`, read `content-type` (default `'image/jpeg'`), set `thumbnailDataUrl = \`data:${mime};base64,${buf.toString('base64')}\``.
      - Never fail the sync if an individual thumbnail fails!
11. Build `AccountLibrary = { fetchedAt: new Date().toISOString(), handle, items }`.
12. Save via `saveLibrary(accountId, library)`.
13. If `handle` was discovered, also persist `handle` onto the account via `updateAccount(accountId, { handle, lastSignedIn: true, lastCheckedAt: new Date().toISOString() })`!
14. Return `{ ok: true, library, message: \`Synced ${items.length} video${items.length === 1 ? '' : 's'} from TikTok\` }`.

### D.4 Desktop IPC & Preload
- **`packages/desktop/src/main/ipc.ts`**:
  - `library:load`: `(_event, accountId: string) => loadLibrary(accountId)`
  - `library:sync`: calls `syncAccountLibrary(accountId, { browserPath: loadSettings().browserPath, source: 'desktop' })`; if `!result.ok && !result.locked && /login|expired|signed in/i.test(result.message)`, updates `signedIn.set(accountId, false)`.
  - `shell:open-external`: validates URL strictly before opening:
    ```ts
    ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl)
        if (
          parsed.protocol === 'https:' &&
          (parsed.hostname === 'tiktok.com' || parsed.hostname.endsWith('.tiktok.com'))
        ) {
          await shell.openExternal(parsed.toString())
          return { ok: true }
        }
        return { ok: false }
      } catch {
        return { ok: false }
      }
    })
    ```
- **`packages/desktop/src/preload/index.ts` & `index.d.ts`**:
  - Add `library: { load(accountId: string): Promise<AccountLibrary | null>; sync(accountId: string): Promise<SyncLibraryResult> }`
  - Add `openExternal(url: string): Promise<{ ok: boolean }>`

### D.5 Desktop UI (`packages/desktop/src/renderer/src/components/TikTokLibraryView.tsx`)
Props:
```ts
export interface TikTokLibraryViewProps {
  account: AccountSummary
  library: AccountLibrary | null
  syncing: boolean
  onSync: () => void
  onSignIn: () => void
  onImportCookies: () => void
}
```
Layout & Features:
1. **Toolbar (`.library-toolbar`)**:
   - Search box (`type="search"`, placeholder `"Search captions…"`)
   - Status filter pills (`All`, `Published`, `Scheduled`, `Private`, `Draft`) with counts
   - Spacer
   - Last synced relative label (`Synced 3m ago` or `Not synced yet`)
   - **Open Studio** button (`ExternalLinkIcon`, calls `window.api.openExternal('https://www.tiktok.com/tiktokstudio/content')`)
   - **Sync Videos** primary button (`RefreshIcon`, disabled while `syncing || account.locked`)
2. **States**:
   - `!account.signedIn && !library`: Empty card with **Sign In** and **Import Chrome Cookies** buttons.
   - `!library && !syncing`: Empty card explaining local TikTok Studio sync with **Sync My TikTok Videos** primary button.
   - `syncing && !library`: Clean 6-card pulsing skeleton grid (`.library-skeleton`).
   - `library && filtered.length === 0`: Empty card (*"No videos match your filter"* or *"No videos found on this TikTok account"*).
3. **Video Card Grid (`.library-grid`)**:
   - `display: grid; grid-template-columns: repeat(auto-fill, minmax(206px, 1fr)); gap: 14px; padding: 16px 18px; overflow-y: auto; flex: 1 1 auto;`
   - Each `.library-card`:
     - Elevated card (`background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-xs); display: flex; flex-direction: column; transition: border-color 120ms ease, transform 120ms ease;`).
     - Poster box (`.library-poster`, `aspect-ratio: 4 / 5; background: var(--surface-2); position: relative; overflow: hidden;`):
       - `<img>` (`width: 100%; height: 100%; object-fit: cover;`) when `thumbnailDataUrl` exists, else centered `FilmIcon`.
       - Top-left `.status-pill` badge (`Published` green, `Scheduled` accent, `Private` muted, `Draft` amber).
       - Bottom-right `.duration-chip` (`0:42`) if `durationSec > 0`.
     - Body (`.library-card-body`, `padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1;`):
       - Caption (`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12.5px; font-weight: 500; min-height: 36px;`).
       - Date line (`Scheduled · ...` or `Posted · ...`, `font-size: 11px; color: var(--muted); tabular-nums`).
       - Metrics strip (Views, Likes, Comments formatted compactly: `1.2K`, `420`, `18`).
       - Footer action: full-width subtle **Open on TikTok** button (`btn ghost sm`).

---

## 5. Part E — Multi-Account Management & Parallel Runs

### E.1 True Parallel Multi-Account Execution (Fixes Cross-Account Event Collision!)
- **Current Bug**: `QueueEvent` has no `accountId`, and `App.tsx` tracks a single `running: boolean`. If Account A is running and the user switches to Account B, Account A's `job-status` and `queue-done` events overwrite Account B's UI!
- **Exact Fix**:
  1. **`packages/core/src/types.ts`**: Add optional `accountId?: string` to every branch of `QueueEvent`:
     ```ts
     export type QueueEvent =
       | { type: 'job-status'; accountId?: string; jobId: string; status: JobStatus; error?: string; screenshot?: string }
       | { type: 'job-stage'; accountId?: string; jobId: string; stage: string }
       | { type: 'log'; accountId?: string; jobId?: string; message: string }
       | { type: 'auth-required'; accountId?: string; message: string }
       | { type: 'queue-done'; accountId?: string; done: number; failed: number; skipped: number }
     ```
  2. **`packages/core/src/queue.ts`**: Inside `runQueue()`, ensure `emit` stamps `accountId: options.accountId` on every emitted event:
     ```ts
     const emit = (event: QueueEvent): void =>
       options.onEvent?.({ ...event, accountId: event.accountId ?? options.accountId })
     ```
  3. **`packages/desktop/src/main/ipc.ts`**: Ensure `send(event.sender, { ...queueEvent, accountId })` always includes `accountId` even for IPC-originated lock/error logs.
  4. **`packages/desktop/src/renderer/src/App.tsx`**:
     - Replace `const [running, setRunning] = useState(false)` with:
       ```ts
       const [runningAccounts, setRunningAccounts] = useState<Set<string>>(() => new Set())
       const isCurrentRunning = Boolean(accountId && runningAccounts.has(accountId))
       ```
     - In `onQueue(event)`:
       - Determine `const targetId = event.accountId ?? accountIdRef.current`.
       - Prefix activity log entries with `[${labelOf(targetId)}]` when `accountsRef.current.length > 1`.
       - For `'job-status'`: ONLY mutate `jobsRef.current` / `setJobs` if `targetId === accountIdRef.current`! Also call `void refreshAccounts()` (debounced or on status change) so sidebar counts update live for background accounts too!
       - For `'auth-required'` and `'queue-done'`: remove `targetId` from `runningAccounts` (`next.delete(targetId)`), show a toast naming `labelOf(targetId)`, and call `void refreshAccounts()`.

---

### E.2 Persisted Auth Metadata, Live Queue Counts & Per-Account Defaults
1. **`packages/core/src/types.ts`**:
   Add optional multi-account metadata to `Account` and live summary counters to `AccountSummary`:
   ```ts
   export type AccountColor = 'red' | 'teal' | 'blue' | 'amber' | 'purple' | 'green'

   export interface AccountDefaults {
     visibility?: Visibility
     aiLabel?: boolean
     maxScheduleDays?: number
     bulkEvery?: string
     bulkJitter?: string
     bulkWindow?: string
   }

   export interface Account {
     id: string
     label: string
     handle?: string
     createdAt: string
     group?: string
     color?: AccountColor
     lastSignedIn?: boolean
     lastCheckedAt?: string
     sourceFolder?: string
     recursiveFolder?: boolean
     defaults?: AccountDefaults
   }

   export interface AccountPatch {
     label?: string
     handle?: string
     group?: string
     color?: AccountColor | null
     lastSignedIn?: boolean
     lastCheckedAt?: string
     sourceFolder?: string | null
     recursiveFolder?: boolean | null
     defaults?: AccountDefaults
   }

   export interface AccountSummary extends Account {
     signedIn: boolean
     locked: boolean
     lockSource?: string
     running: boolean
     pendingCount: number
     scheduledCount: number
     failedCount: number
     doneCount: number
     nextSchedule: string | null
   }
   ```
   Also add `maxConcurrentAccounts?: number` to `Settings` (default `2` in `DEFAULT_SETTINGS`).

2. **`packages/core/src/profiles.ts`**:
   Add `updateAccount(id: string, patch: AccountPatch): Account`:
   - Finds account by `assertAccountId(id)` (throws if missing).
   - Updates `label` (trimmed, fallback to existing), `handle`, `group` (trimmed or delete if empty), `color` (delete if `null`), `lastSignedIn`, `lastCheckedAt`, `sourceFolder` (trimmed or delete if `null`/empty), `recursiveFolder` (delete if `null`), and merges `defaults`.
   - Writes `accounts.json` and returns updated `Account`.

3. **`packages/desktop/src/main/ipc.ts`**:
   - Update `summarize(account: Account): AccountSummary`:
     - Reads `loadQueue(account.id)` synchronously (cheap local JSON file read — zero browser launch!):
       - `pendingCount`: `jobs.filter((j) => j.status === 'pending' || j.status === 'running').length`
       - `scheduledCount`: `jobs.filter((j) => (j.status === 'pending' || j.status === 'failed') && Boolean(j.schedule)).length`
       - `failedCount`: `jobs.filter((j) => j.status === 'failed').length`
       - `doneCount`: `jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length`
       - `nextSchedule`: earliest ISO timestamp among pending/failed jobs with `schedule !== null` (or `null`).
     - `running`: `activeRuns.has(account.id)`
     - `signedIn`: `signedIn.has(account.id) ? Boolean(signedIn.get(account.id)) : Boolean(account.lastSignedIn)` — **solves the restart amnesia bug** so accounts immediately reflect their last-known session state on startup!
   - Persist `{ lastSignedIn, lastCheckedAt: new Date().toISOString() }` via `updateAccount()` inside `auth:status`, `auth:login`, and `saveAndVerifyCookies`.
   - Add IPC channels:
     - `accounts:update` (`{ id: string; patch: AccountPatch }`) → `summarize(updateAccount(id, patch))`
     - `queue:append` (`{ accountId: string; jobs: Job[] }`): loads `accountId`'s queue, deduplicates by `videoPath`, appends new jobs, saves to disk, and returns `{ added: number, total: number }` — powers **drag-onto-sidebar-account** and **Copy to Accounts** safely without switching tabs!
     - `queue:start-all` (`{ accountIds: string[]; headed?: boolean }`): orchestrates parallel queue runs across multiple accounts with a concurrency cap (`loadSettings().maxConcurrentAccounts ?? 2`), skipping locked/already-running/0-runnable accounts and emitting normal tagged `queue:event` updates!
   - Sync `packages/desktop/src/preload/index.ts` and `index.d.ts` with `accounts.update`, `queue.append`, and `queue.startAll`.

---

### E.3 All Accounts Overview Dashboard (`components/AccountsOverview.tsx`)
Add a pinned **All Accounts** navigation button at the very top of the sidebar (above `ACCOUNTS` list):
```text
┌───────────────────────┐
│ ● TikTok Uploader     │
├───────────────────────┤
│ ⊞ All Accounts   (6)  │   <-- clicks switch to AccountsOverview
├───────────────────────┤
│ ACCOUNTS          [+] │
│ [ Filter accounts… ]  │   <-- shown when accounts.length >= 5
│ ● Brand Main      4   │
│ ● Clip Lab       !1   │
│ ○ New Creator         │
```
Inside `AccountsOverview.tsx`:
1. **Header**: Title `All Accounts`, plus two batch buttons:
   - **Check All Sessions** (runs `window.api.auth.status(id)` sequentially across unlocked accounts, showing `"Checking 2 / 6…"` progress and updating `lastSignedIn` + `lastCheckedAt`).
   - **Run All Ready** (primary button, disabled when 0 accounts have pending/failed jobs + signed-in; calls `window.api.queue.startAll({ accountIds: readyIds, headed })` with a quick confirmation showing how many accounts & total videos will run).
2. **Summary KPI Strip** (4 compact cards):
   - **Accounts** (`N total · M signed in`)
   - **Pending Videos** (sum of `pendingCount` + `failedCount`)
   - **Currently Running** (`runningAccounts.size` with live pulse dot)
   - **Needs Attention** (accounts with `failedCount > 0` or `!signedIn`)
3. **Overview Table** (elevated `.queue-surface` card):
   - Columns: **Account** (color avatar initial + label + `@handle` + group pill), **Session** (`AccountChip` + relative `lastCheckedAt`), **Queue** (Pending / Scheduled / Failed / Done pills), **Next Slot** (`formatWhen(nextSchedule)`), **Actions** (`Open`, `Run`/`Stop`, `Cookies`, `Edit`).
   - Optional group filter pills above the table if any accounts have a `group` assigned.

---

### E.4 Smarter Multi-Account Sidebar, Drag-to-Account, Shortcuts & Cross-Posting
1. **Live Badges & Color Avatars on Sidebar Items**:
   - Each `.account-item` displays:
     - Status dot (`.status-dot.running` animated pulse when running, `.locked` amber, `.ok` green, `.off` muted)
     - Optional tiny color bar/dot if `account.color` is set
     - `<span className="account-name">{label}</span>` (truncates cleanly!)
     - Right-aligned compact badges: red `!{failedCount}` pill when `failedCount > 0`, muted `{pendingCount}` pill when `pendingCount > 0`.
2. **Sidebar Search & Group Filter**:
   - When `accounts.length >= 5`, show a compact `<input type="search" className="sidebar-search" placeholder="Filter accounts…" />` right below `ACCOUNTS` header, filtering by `label`, `handle`, or `group`.
3. **Drag-and-Drop Directly Onto Any Sidebar Account**:
   - Add `onDragOver`, `onDragLeave`, `onDrop` handlers on each `.account-item` (calling `e.stopPropagation()` so the global drop overlay doesn't intercept it).
   - Highlight the hovered account row with `.account-item.drop-target` (`outline: 2px dashed var(--accent); background: var(--accent-soft);`).
   - On drop: expand dropped files/folders (using that target account's `recursiveFolder` + `defaults`), call `window.api.queue.append({ accountId: target.id, jobs: newJobs })` (or `addItems` if it's the active account), refresh sidebar counts, and toast `Added N video(s) to "${target.label}"`!
4. **Keyboard Shortcuts (`App.tsx` global `keydown`)**:
   - Ignore when focus is inside `input`, `textarea`, `select`, or `[contenteditable]`, or when a modal is open.
   - `Cmd/Ctrl + 0` → switch to **All Accounts Overview**.
   - `Cmd/Ctrl + 1` through `Cmd/Ctrl + 9` → switch directly to the 1st–9th visible account in the sidebar.
5. **Linked Source Folder + 1-Click Scan**:
   - When `currentAccount.sourceFolder` is set, show a **Scan Folder** button (`FolderSyncIcon` / `RefreshIcon`) in the Queue sub-toolbar with tooltip showing the folder path.
   - Clicking **Scan Folder** calls `window.api.videos.list(currentAccount.sourceFolder, { recursive: effectiveRecursive })`, deduplicates against ALL existing `jobs` (both Queue and Completed!), adds only brand-new videos, and shows a toast (`Added 4 new videos` or `No new videos in linked folder`).
6. **Account Settings Modal (`components/AccountSettingsModal.tsx`)**:
   - Replaces the basic 1-field Rename modal (opened from sidebar **Edit** button or Overview table **Edit** button):
     - **Profile**: Account Name (`label`), Group/Tag (optional, e.g. `Clients`, `Personal`), Color accent swatch picker (6 subtle presets + None).
     - **Linked Source Folder**: read-only path input + **Browse** (`window.api.videos.pickFolder()`) + **Clear** button, plus **Include subfolders** selector (`Inherit global` / `Yes` / `No`).
     - **Account Defaults (Overrides Global Settings)**:
       - Default Visibility (`Inherit` / `Everyone` / `Friends` / `Private`)
       - Default AI Label (`Inherit` / `On` / `Off`)
       - Schedule Horizon (`Inherit` / `10 days` / `30 days (TikTok Studio)`)
       - Default Bulk Schedule Preset (`Every`, `Jitter`, `Quiet window` — pre-populates `BulkModal` whenever opened for this account!).
7. **Copy to Accounts Modal (`components/CopyToAccountsModal.tsx`)**:
   - Triggered from a subtle **Copy to accounts** icon button (`CopyPlusIcon` / `ShareIcon`) on each `JobRow` (hidden if `accounts.length < 2`).
   - Shows checkboxes/cards for all *other* accounts (label + group + status dot), plus an option toggle:
     - **Keep schedule** vs **Clear schedule (post now / stagger later)** (default: clear schedule so you don't accidentally collide slots across accounts).
   - Clicking **Copy to N account(s)** calls `window.api.queue.append` for each selected account, refreshes sidebar counts, and shows a toast (`Copied to 3 accounts`).

---

## 6. Complete File Checklist (In Implementation Order)

| # | File | Action | Scope |
|---|---|---|---|
| 1 | `packages/core/src/types.ts` | Edit | Add `restored?` on `AuthStatus`; `recursiveFolder?` & `maxConcurrentAccounts?` on `Settings`; `accountId?` on `QueueEvent`; `RemoteVideoStatus`, `TikTokVideo`, `AccountLibrary`; `AccountColor`, `AccountDefaults`, `AccountPatch`, extended `Account` & `AccountSummary` |
| 2 | `packages/core/src/settings.ts` | Edit | Default `recursiveFolder: false`, `maxConcurrentAccounts: 2` |
| 3 | `packages/core/src/paths.ts` | Edit | Add `libraryPath(id)` |
| 4 | `packages/core/src/selectors.ts` | Edit | Add `PATHS.content` and `SELECTORS.library` |
| 5 | `packages/core/src/videos.ts` | Edit | Add `{ recursive?: boolean }` support with hidden-entry skip & symlink cycle protection |
| 6 | `packages/core/src/profiles.ts` | Edit | Add `updateAccount(id, patch)` |
| 7 | `packages/core/src/queue.ts` | Edit | Stamp `accountId` on all emitted `QueueEvent`s |
| 8 | `packages/core/src/uploader/auth.ts` | Edit | Return `restored: true` when `applyImportedCookies()` restores previous cookies |
| 9 | `packages/core/src/uploader/library.ts` | Create | `loadLibrary`, `saveLibrary`, `parseCreatorApiPayload`, `syncAccountLibrary` (API interception + DOM fallback + CSP-safe base64 thumbnails) |
| 10 | `packages/core/src/index.ts` | Edit | Export library module functions & types |
| 11 | `packages/core/tests/videos.test.ts` | Edit | Tests for recursive vs non-recursive `listVideos`, hidden folders, symlinks |
| 12 | `packages/core/tests/profiles.test.ts` | Edit | Tests for `updateAccount` (label, group, color, sourceFolder, defaults, clearing nulls) |
| 13 | `packages/core/tests/library.test.ts` | Create | Tests for `parseCreatorApiPayload` & `loadLibrary`/`saveLibrary` |
| 14 | `packages/cli/src/index.ts` | Edit | Add `-r, --recursive` flag to `upload` command |
| 15 | `packages/desktop/src/main/index.ts` | Edit | Subscribe to `nativeTheme.on('updated', ...)` for live system background sync |
| 16 | `packages/desktop/src/main/ipc.ts` | Edit | Fix `saveAndVerifyCookies` order/rollback; update `videos:list` recursive arg; enrich `summarize()` with live queue counts + persisted `lastSignedIn`; add `accounts:update`, `queue:append`, `queue:start-all`, `library:load`, `library:sync`, `shell:open-external` (allowlisted to `tiktok.com`); stamp `accountId` on `queue:event` |
| 17 | `packages/desktop/src/preload/index.d.ts` | Edit | Sync all new/updated IPC types |
| 18 | `packages/desktop/src/preload/index.ts` | Edit | Expose `accounts.update`, `videos.list(dir, opts)`, `queue.append`, `queue.startAll`, `library.load`, `library.sync`, `openExternal` |
| 19 | `packages/desktop/src/renderer/src/components/Icons.tsx` | Edit | Add `GridIcon`, `ExternalLinkIcon`, `CopyPlusIcon`, `EyeIcon`, `HeartIcon`, `MessageIcon`, `SearchIcon`, `SlidersIcon` |
| 20 | `packages/desktop/src/renderer/src/components/JobRow.tsx` | Edit | Fix `.schedule-input-wrap` flex layout, single caption badge, screenshot block spacing, add optional `onCopyToAccounts` button |
| 21 | `packages/desktop/src/renderer/src/components/CompletedRow.tsx` | Create | Read-only completed history row with **Re-queue** and **Remove** |
| 22 | `packages/desktop/src/renderer/src/components/TikTokLibraryView.tsx` | Create | Existing TikTok videos grid with search, status filters, sync button, thumbnails, metrics, Open on TikTok |
| 23 | `packages/desktop/src/renderer/src/components/AccountsOverview.tsx` | Create | All Accounts command center with KPI strip, multi-account table, **Run All Ready**, and **Check All Sessions** |
| 24 | `packages/desktop/src/renderer/src/components/AccountSettingsModal.tsx` | Create | Per-account editor: label, group, color, linked source folder, recursive override, default visibility/AI/horizon/bulk-schedule preset |
| 25 | `packages/desktop/src/renderer/src/components/CopyToAccountsModal.tsx` | Create | Cross-post modal to copy a video to selected other accounts |
| 26 | `packages/desktop/src/renderer/src/components/ImportCookiesModal.tsx` | Edit | Fix empty paste badge (`Auto-detect` instead of `Unknown format`) |
| 27 | `packages/desktop/src/renderer/src/components/BulkModal.tsx` | Edit | Accept optional initial `defaultEvery`/`defaultJitter`/`defaultWindow` from account defaults; trim `every` on preset check |
| 28 | `packages/desktop/src/renderer/src/components/SettingsModal.tsx` | Edit | Add `Include subfolders by default` toggle and `Max parallel accounts` (1–4) selector |
| 29 | `packages/desktop/src/renderer/src/styles.css` | Edit | Apply all Part A CSS fixes + workspace tabs, library grid/cards/skeleton, overview KPIs/table, sidebar search/badges/drop-target/color-swatches, balanced account-actions |
| 30 | `packages/desktop/src/renderer/src/App.tsx` | Edit | Wire review fixes, recursive toggle, 3-tab workspace (`Queue` / `Completed` / `TikTok Library`), strict bulk-schedule & run scoping, parallel `runningAccounts` Set, All Accounts Overview, drag-to-sidebar-account, `Cmd/Ctrl + 0..9` shortcuts, Scan Linked Folder, `AccountSettingsModal`, `CopyToAccountsModal` |

---

## 7. Verification Protocol (Must All Pass Before Finishing)

### 7.1 Automated Checks
Run in this exact order from the repository root:
```bash
npm run typecheck
npm test
npm run build:cli
npm run build -w @tiktok-uploader/desktop
rg -n "window\.confirm|window\.alert|file-id|account-id" packages/desktop/src/renderer/src
```
Expected:
- **0 TypeScript errors** across core, cli, and desktop (`tsconfig.node.json` + `tsconfig.web.json`).
- **All tests pass** (existing 111 + new recursive `videos.test.ts`, `updateAccount` in `profiles.test.ts`, and `library.test.ts`).
- Clean CLI & desktop builds.
- **0 ripgrep matches** for banned browser popups or leaked internal IDs.

### 7.2 Manual Smoke Checks (`npm run dev:desktop`)
- [ ] **Part A Review Fixes**:
  - Failed cookie import on a signed-in account keeps previous session, keeps green **Signed in** chip, and does NOT overwrite `cookies.txt`.
  - Schedule `✕` button sits beside the datetime input and does not cover the calendar picker.
  - Row trash button turns red on hover; no `--account <id>` leaks into Activity Log; long account names ellipsize cleanly; empty state buttons sit side-by-side with clickable Sign In / Chrome Cookies links.
- [ ] **Part B Recursive Folder Upload**:
  - Toggle **Subfolders** OFF → add a parent folder with nested subfolders → only top-level videos are imported.
  - Toggle **Subfolders** ON → add or drag-drop the same parent folder → nested videos are discovered and added (hidden folders like `.git` skipped).
  - Verify `tiktok-up upload -r --dry-run <folder>` discovers nested videos in CLI.
- [ ] **Part C Queue vs. Completed Separation**:
  - With both `pending` and `done` jobs: **Queue** tab shows only active jobs; **Completed** tab shows only `done`/`skipped`.
  - Click **Bulk Schedule** → schedules ONLY pending/failed rows; verify `done` rows in **Completed** keep their original timestamps untouched.
  - Click **Re-queue** on a completed video → moves it back to **Queue** as `pending`.
- [ ] **Part D TikTok Library**:
  - Open **TikTok Library** tab → click **Sync Videos** on a signed-in account → videos and thumbnails load cleanly (check DevTools console for 0 CSP errors!).
  - Filter by status (`Published`, `Scheduled`, `Private`) and search captions; restart app and confirm cached library loads immediately without launching Chrome; click **Open on TikTok** to verify browser launch.
- [ ] **Part E Multi-Account Management**:
  - Click **All Accounts** in sidebar → verify KPI cards, per-account counts, **Check All Sessions**, and **Run All Ready**.
  - Start Account A's queue, immediately switch to Account B → verify Account A keeps a live running indicator in the sidebar without clobbering Account B's queue view.
  - Drag a video file directly onto a non-active account in the sidebar → queues it into that account and increments its sidebar badge.
  - Press `Cmd/Ctrl + 0` (Overview) and `Cmd/Ctrl + 1..2` (Accounts) → switches cleanly.
  - Open **Edit** on an account → set a color, group, linked source folder, and 30-day Studio horizon → verify **Scan Folder** imports new videos and **Copy to Accounts** copies a row to another account.
