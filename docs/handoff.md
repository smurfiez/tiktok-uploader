# Handoff Fixes — Code Review Follow-Up

> **Status: applied.** All 8 fixes below are implemented in `667eb4a` (`fix(desktop): apply handoff review fixes`).
> Verification at that commit: `npm run typecheck`, `npm test` (140/140), `npm run build:cli`, and
> `npm run build -w @tiktok-uploader/desktop` all pass; the §3 `rg` sweep is clean.
> The §3 manual checklist still needs a real browser/TikTok session to confirm.
>
> **Context**: All 5 major features (Part A review fixes, recursive folder upload, Queue/Completed split, TikTok Library, and Multi-Account Overview/parallel runs) are implemented.
> The sections below are kept as the reference record of what was fixed and why.

## Applied

- [x] 1.1 Library sync no longer exits on loading skeleton rows
- [x] 1.2 Per-account `defaults.maxScheduleDays` honored by `schedule:stagger` and `runQueue`
- [x] 1.3 `Run All Ready` queues accounts above `maxConcurrentAccounts` and drains them as slots free up
- [x] 1.4 Unhandled `runQueue` error emits `queue-done`; renderer syncs `runningAccounts` to main
- [x] 1.5 Stop keeps `Run` disabled and shows `Stopping…` until the in-flight upload settles
- [x] 2.1 `AccountSettingsModal` accepts combined bulk every/jitter/quiet-window defaults
- [x] 2.2 `signedIn`/`lastSignedIn`/`lastCheckedAt` synced on `library:sync`
- [x] 2.3 Table layout, empty-queue Run, row actions, and fast account switching

Known gap: a queued (not yet running) account has no cancel button; `queue:stop` only targets active runs.

---

## 1. High-Priority Bugs

### 1.1 TikTok Library Sync Exits Early on Loading Skeleton Rows
- **File**: `packages/core/src/uploader/library.ts` (lines 308–320)
- **Bug**: `SELECTORS.library.row` includes `table tbody tr`. When TikTok Studio renders a loading/skeleton `<tr>` before its async JSON API finishes, line 315 breaks out of the wait loop immediately with `captured.size === 0`, falls through to DOM scraping (finding 0 `a[href*="/video/"]` links on the skeleton), and overwrites `library.json` with an empty list.
- **Exact Fix**: Replace lines 308–319 in `packages/core/src/uploader/library.ts`:
  ```ts
  const startedAt = Date.now()
  const deadline = startedAt + 12_000
  let settleUntil: number | undefined
  while (Date.now() < deadline) {
    if (captured.size > 0) {
      // secondary item-list pages settle shortly after the first response
      settleUntil ??= Date.now() + 1_500
      if (Date.now() >= settleUntil) break
    } else if (
      Date.now() - startedAt >= 3_500 &&
      (await page.locator(SELECTORS.library.videoLink).count().catch(() => 0)) > 0
    ) {
      // only fall back to DOM once real video links are rendered AND the API had time to fire
      break
    }
    await sleep(500)
  }
  ```

---

### 1.2 Per-Account `defaults.maxScheduleDays` Ignored by `schedule:stagger` and `runQueue`
- **Files**:
  - `packages/desktop/src/main/ipc.ts` (lines 316–321 and 363–381)
  - `packages/desktop/src/preload/index.ts` (line `schedule.stagger`)
  - `packages/desktop/src/preload/index.d.ts` (line `schedule.stagger`)
  - `packages/desktop/src/renderer/src/components/BulkModal.tsx` (lines 8–64)
  - `packages/desktop/src/renderer/src/App.tsx` (line 1585)
- **Bug**: An account with `defaults.maxScheduleDays = 30` (TikTok Studio) still gets validated against global `settings.maxScheduleDays` (10) in both `schedule:stagger` and `startRun`, causing Bulk Schedule and uploads beyond 10 days to fail.
- **Exact Fix**:
  1. In `packages/desktop/src/main/ipc.ts`:
     - Add helper near `accountLabel`:
       ```ts
       const accountMaxDays = (accountId?: string): number => {
         const fallback = loadSettings().maxScheduleDays
         if (!accountId) return fallback
         return (
           listAccounts().find((account) => account.id === accountId)?.defaults?.maxScheduleDays ??
           fallback
         )
       }
       ```
     - Update `schedule:stagger` (lines 316–321):
       ```ts
       ipcMain.handle(
         'schedule:stagger',
         (_event, input: { count: number; rule: StaggerRule; accountId?: string }) => {
           const now = new Date()
           const dates = buildStaggeredSchedule({ ...input.rule, count: input.count }, now)
           assertSchedulable(dates, now, accountMaxDays(input.accountId))
           return dates.map((date) => date.toISOString())
         }
       )
       ```
     - In `startRun` (line 378), change:
       ```ts
       maxScheduleDays: accountMaxDays(accountId),
       ```
  2. In `packages/desktop/src/preload/index.d.ts` and `index.ts`:
     - Update `schedule.stagger(count: number, rule: StaggerRule, accountId?: string): Promise<string[]>` and pass `{ count, rule, accountId }`.
  3. In `packages/desktop/src/renderer/src/components/BulkModal.tsx`:
     - Add optional `accountId?: string` prop and pass `accountId` to `window.api.schedule.stagger(count, rule, accountId)` (and include `accountId` in the `useEffect` dependency array).
  4. In `packages/desktop/src/renderer/src/App.tsx` (line 1586):
     - Pass `accountId={currentAccount?.id}` to `<BulkModal ... />`.

---

### 1.3 `Run All Ready` Silently Drops Accounts Above `maxConcurrentAccounts` Instead of Queuing Them
- **Files**:
  - `packages/desktop/src/main/ipc.ts` (lines 50–57, 339–445)
  - `packages/desktop/src/preload/index.d.ts` & `index.ts` (`queue.startAll` return type)
  - `packages/desktop/src/renderer/src/components/AccountsOverview.tsx` (lines 89–102)
- **Bug**: When 5 accounts are ready and `maxConcurrentAccounts = 2`, `queue:start-all` starts #1–#2 and drops #3–#5 into `skipped` permanently, and `AccountsOverview` ignores the response so the user thinks all 5 started.
- **Exact Fix**:
  1. In `packages/desktop/src/main/ipc.ts`, add a small pending batch queue alongside `activeRuns`:
     ```ts
     interface QueuedAccountRun {
       contents: Electron.WebContents
       accountId: string
       headed?: boolean
     }
     const pendingBatch: QueuedAccountRun[] = []
     ```
  2. Add a `drainPendingBatch()` helper inside `registerIpc`:
     ```ts
     function drainPendingBatch(): void {
       const cap = loadSettings().maxConcurrentAccounts ?? 2
       while (activeRuns.size < cap && pendingBatch.length > 0) {
         const next = pendingBatch.shift()
         if (!next || next.contents.isDestroyed()) continue
         if (activeRuns.has(next.accountId) || lockStatus(next.accountId) !== null) continue
         const jobs = loadQueue(next.accountId)
         if (!jobs.some(isRunnable)) continue
         startRun(next.contents, next.accountId, jobs, next.headed)
       }
     }
     ```
  3. Call `drainPendingBatch()` at the end of `startRun(...).finally(...)` (right after `activeRuns.delete(accountId)`), AND in `queue:stop` also remove `accountId` from `pendingBatch` if waiting, AND in `dispose()` clear `pendingBatch.length = 0`.
  4. Update `queue:start-all` to start up to `cap` immediately and push remaining valid accounts into `pendingBatch`, returning `{ started, queued, skipped }`:
     ```ts
     ipcMain.handle(
       'queue:start-all',
       (event, input: { accountIds: string[]; headed?: boolean }) => {
         const cap = loadSettings().maxConcurrentAccounts ?? 2
         const started: string[] = []
         const queued: string[] = []
         const skipped: string[] = []

         for (const accountId of input.accountIds) {
           const jobs = loadQueue(accountId)
           if (
             activeRuns.has(accountId) ||
             pendingBatch.some((item) => item.accountId === accountId) ||
             lockStatus(accountId) !== null ||
             !jobs.some(isRunnable)
           ) {
             skipped.push(accountId)
             continue
           }
           if (activeRuns.size < cap) {
             if (startRun(event.sender, accountId, jobs, input.headed).started) started.push(accountId)
             else skipped.push(accountId)
           } else {
             pendingBatch.push({ contents: event.sender, accountId, headed: input.headed })
             queued.push(accountId)
           }
         }

         return { started, queued, skipped }
       }
     )
     ```
  5. Update `preload/index.d.ts` `queue.startAll` return type to `Promise<{ started: string[]; queued: string[]; skipped: string[] }>`.
  6. In `AccountsOverview.tsx`, pass an optional `onNotify?: (message: string, tone?: 'info' | 'ok' | 'error') => void` prop (wired to `pushToast` in `App.tsx`) and after `startAll()` show a clear summary, e.g.:
     `Started ${res.started.length} account(s)${res.queued.length ? `, ${res.queued.length} queued next` : ''}${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}`.

---

### 1.4 `runningAccounts` Can Get Stuck Forever on Unhandled `runQueue` Error
- **Files**:
  - `packages/desktop/src/main/ipc.ts` (lines 390–396)
  - `packages/desktop/src/renderer/src/App.tsx` (lines 190–202)
- **Bug**: If `runQueue` throws, `.catch()` only emits `'log'` (never `'queue-done'`), and `refreshAccounts()` only *adds* `account.running` entries without ever removing stopped ones.
- **Exact Fix**:
  1. In `packages/desktop/src/main/ipc.ts` inside `startRun`'s `.catch(...)`:
     ```ts
     .catch((error) => {
       send(contents, accountId, { type: 'log', message: `Queue failed: ${errorMessage(error)}` })
       send(contents, accountId, { type: 'queue-done', done: 0, failed: 0, skipped: 0 })
     })
     ```
  2. In `packages/desktop/src/renderer/src/App.tsx` inside `refreshAccounts()` (lines 190–202), sync `runningAccounts` directly to main's truth (`list.filter((a) => a.running)`):
     ```ts
     setRunningAccounts((prev) => {
       const live = new Set(list.filter((a) => a.running).map((a) => a.id))
       if (live.size === prev.size && [...live].every((id) => prev.has(id))) return prev
       return live
     })
     ```

---

### 1.5 Clicking `Stop` Re-Enables `Run` Before the In-Flight Upload Finishes
- **File**: `packages/desktop/src/renderer/src/App.tsx` (lines 665–688 and 716–728)
- **Bug**: `stopQueue()` and `stopAccount()` immediately remove `id` from `runningAccounts`, re-enabling the `Run` button while the in-flight upload is still executing and holding `account.lock`.
- **Exact Fix**:
  - Add `const [stoppingAccounts, setStoppingAccounts] = useState<Set<string>>(() => new Set())`.
  - In `stopQueue()` / `stopAccount()`: do NOT delete `id` from `runningAccounts` when `result.stopped` is `true` — instead add `id` to `stoppingAccounts` (if `!result.stopped`, then delete from both sets).
  - On `'queue-done'` / `'auth-required'` (and when `refreshAccounts()` sees `!account.running`), delete `targetId` from `stoppingAccounts`.
  - Show `Stopping…` (disabled) on the `Stop` button while `stoppingAccounts.has(id)`.

---

## 2. Medium Polish & Edge Cases

### 2.1 `AccountSettingsModal` Should Allow Combining Bulk Schedule Defaults
- **File**: `packages/desktop/src/renderer/src/components/AccountSettingsModal.tsx` (lines 17–49, 73, 96–101, 250–275)
- **Problem**: Currently uses a single mutually exclusive dropdown (`Every 12h` OR `Every 1d` OR `Jitter 15m` OR `Quiet 09:00-21:00`), so you cannot set both `Every 12h` and `Quiet 09:00-21:00` or custom values like `6h`.
- **Exact Fix**: Replace `bulk` dropdown with 3 optional text inputs in a clean compact row/grid:
  - `bulkEvery` (placeholder `"e.g. 12h, 1d"`)
  - `bulkJitter` (placeholder `"e.g. 15m"`)
  - `bulkWindow` (placeholder `"e.g. 09:00-21:00"`)
  - On save:
    ```ts
    bulkEvery: bulkEvery.trim() || undefined,
    bulkJitter: bulkJitter.trim() || undefined,
    bulkWindow: bulkWindow.trim() || undefined
    ```

### 2.2 Sync `signedIn` / `lastSignedIn` Consistently on `library:sync`
- **Files**: `packages/core/src/uploader/library.ts` (lines 396–403), `packages/desktop/src/main/ipc.ts` (lines 455–464)
- **Exact Fix**:
  1. In `packages/core/src/uploader/library.ts` (line 396), always persist `lastSignedIn: true, lastCheckedAt` on successful sync (not only `if (handle)`):
     ```ts
     updateAccount(accountId, {
       ...(handle ? { handle } : {}),
       lastSignedIn: true,
       lastCheckedAt: new Date().toISOString()
     })
     ```
  2. In `packages/desktop/src/main/ipc.ts` inside `library:sync`:
     ```ts
     if (result.ok) {
       signedIn.set(accountId, true)
     } else if (!result.locked && /login|expired|signed in/i.test(result.message)) {
       signedIn.set(accountId, false)
       updateAccount(accountId, { lastSignedIn: false, lastCheckedAt: new Date().toISOString() })
     }
     ```

### 2.3 Table Layout & Interaction Polish
1. **Never put `display: flex` directly on `<td>` inside `table-layout: fixed`** (`AccountsOverview.tsx` lines 214 & 251, `styles.css` lines 2567 & 2644):
   - Keep `<td>` as a normal table cell and wrap its children inside `<div className="account-cell">...</div>` and `<div className="actions-cell">...</div>`.
   - Also set explicit column widths on `.overview-table th` (e.g. Account `26%`, Session `20%`, Queue `22%`, Next Slot `14%`, Actions `18%`).
2. **Disable Overview per-row `Run` button when queue has 0 runnable videos** (`AccountsOverview.tsx` line 264):
   - Change `disabled={!account.signedIn || account.locked}` to:
     `disabled={!account.signedIn || account.locked || account.pendingCount + account.failedCount === 0}`
3. **Tidy `JobRow` row actions** (`JobRow.tsx` lines 166–186, `styles.css`):
   - Wrap the `Copy to accounts` button and `Remove` button inside `<div className="row-actions">` (`display: flex; align-items: center; gap: 4px; margin-top: 8px;`) and remove `float: right` from `.status-cell .remove-btn` so buttons align cleanly inside the `118px` column.
4. **Skip redundant headless `auth.status` launch when recently checked** (`App.tsx` lines 264–290):
   - In the auto session-check `useEffect`, check `accountsRef.current.find((a) => a.id === accountId)?.lastCheckedAt`. If it was checked less than `5 * 60_000` ms (5 minutes) ago, skip launching headless Chromium automatically. This makes switching between accounts instant and avoids lock collisions with **Sync Videos**.

---

## 3. Verification Checklist

The commands below already pass at `667eb4a`; re-run them after any follow-up change.

```bash
npm run typecheck
npm test
npm run build:cli
npm run build -w @tiktok-uploader/desktop
rg -n "window\.confirm|window\.alert|file-id|account-id" packages/desktop/src/renderer/src
```

### Confirm Each Fix Manually (`npm run dev:desktop`)
- [ ] **30-day per-account horizon**: Set an account's Schedule Horizon override to `30 days` (while global Settings is `10 days`) → open **Bulk Schedule** and stagger 15 days out → preview succeeds and Apply works.
- [ ] **Bulk defaults**: Set `Every: 6h`, `Jitter: 15m`, `Quiet window: 09:00-21:00` in **Account Settings** → reopen **Bulk Schedule** → all three pre-fill cleanly.
- [ ] **Run All Ready draining**: With 3 ready accounts and `Max parallel accounts = 1`, click **Run All Ready** → toast reports 1 started, 2 queued; when account #1 finishes, account #2 starts automatically.
- [ ] **Graceful Stop**: Click **Stop** during a run → button shows `Stopping…` (disabled) until `queue-done` fires, never prematurely re-enabling `Run`.
- [ ] **Overview table**: Borders and vertical alignment across all columns render cleanly; `Run` is disabled on accounts with 0 pending/failed videos.
- [ ] **Fast account switching**: After **Check All Sessions**, clicking through accounts switches immediately without spawning headless Chromium on every click.
- [ ] **TikTok Library**: Sync waits for real API / video links instead of breaking on a skeleton row, and updates `signedIn` / `lastCheckedAt` cleanly.
