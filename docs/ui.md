# Comprehensive Implementation Plan: Studio-Grade Desktop UI, Light Mode, Chrome Cookie Import & Label-Only Accounts

> **Handoff Note**: This specification is designed to be followed step-by-step by any developer or AI assistant. Every file path, architecture choice, visual rule, TypeScript signature, CSS token, and anti-pattern is spelled out explicitly. **Do not improvise raw browser controls or shortcut the styling** — the visual polish rules in Section 3 are essential to making this app look like a commercial macOS/Windows desktop product (e.g. Linear / Raycast / Buffer) rather than a homegrown utility.

---

## 0. Hard Rules & Anti-Patterns (Read Before Writing Any Code)

### Repository Invariants (`AGENTS.md`)
- **Code style**: TypeScript, **no semicolons**, **single quotes**, **2-space indentation**.
- **Zero Electron in Core**: `packages/core` must NEVER import `electron`.
- **Single Core Entrypoint**: Desktop and CLI must ONLY import from `'@tiktok-uploader/core'` (never deep imports).
- **Sandboxed Renderer**: `packages/desktop/src/renderer/**` must NEVER import Node `fs`/`path` or `electron`. All side effects go through `window.api`.
- **IPC Sync**: Every IPC change must update all three files together:
  1. `packages/desktop/src/main/ipc.ts`
  2. `packages/desktop/src/preload/index.ts`
  3. `packages/desktop/src/preload/index.d.ts`
- **No Cached Env Paths**: Do not cache `dataDir()` or `TIKTOK_UPLOADER_HOME` at module load.
- **Keep CLI & Tests Green**: Never break `addAccount(id, label)` or existing CLI commands.

### Visual Polish Anti-Patterns — **DO NOT DO THESE**
1. **NO `window.confirm()` or `window.alert()`**: Replace every native browser dialog (such as deleting an account) with a styled in-app confirmation modal.
2. **NO raw Unicode symbols (`✕`, `▾`, `▸`) as icons**: Use crisp, uniform-stroke (`1.75px`) inline SVG icons from `components/Icons.tsx` everywhere.
3. **NO raw HTML checkboxes for settings or video options**:
   - Use a styled **Toggle Switch** component (`components/ToggleSwitch.tsx`) for boolean toggles (`Show browser`, `Run headless`, `Default AI label`).
   - Use **Interactive Toggle Pills** (`button` with `aria-pressed`) for per-video options (`Draft`, `AI`, `Comments`, `Duet`, `Stitch`).
4. **NO exposed internal IDs**: Never render `account.id` or `job.id` anywhere in the UI, dropdowns, modals, delete confirmations, or log lines. Users ONLY ever see `account.label` and video filenames.
5. **NO hardcoded dark hex colors in component CSS**: Every background, text, border, badge, and hover color MUST use CSS custom properties defined in both `[data-theme='dark']` and `[data-theme='light']`.
6. **NO unstyled OS scrollbars or unstyled `<select>` arrows**: Style custom thin scrollbars and custom chevron indicators on selects.
7. **NO silent actions**: Show subtle auto-dismissing **Toast notifications** for user actions (imported cookies, saved settings, added videos, copied log, added/removed account).

---

## 1. Visual Architecture & Layout Blueprint

Move from the cramped single-row toolbar into a **two-pane desktop app layout**: a clean **Left Sidebar (`236px`)** for Accounts, Theme & Settings, and a spacious **Main Workspace** for the Upload Queue and Activity Log.

```text
┌───────────────────────┬──────────────────────────────────────────────────────────────────────┐
│ ● TikTok Uploader     │  Brand Main   [● Signed in]        [Show browser (o)]  [ ▶ Run (4) ] │
├───────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ ACCOUNTS          [+] │  [+ Add Videos] [Add Folder] [Bulk Schedule]  4 queued · 3 scheduled │
│                       ├──────────────────────────────────────────────────────────────────────┤
│ ▌● Brand Main    ···  │  VIDEO             CAPTION                SCHEDULE       OPTIONS     │
│  ● Personal Clip      │  ┌──┐                                                                │
│  ○ New Creator        │  │▶ │ clip_01.mp4  Check out our new...   Tomorrow 6 PM  [Everyone▾] │
│                       │  └──┘ MP4          48 / 150               [date input✕]  [Draft][AI] │
│                       │                                                          [Cmt][Duet] │
│                       │                                           ● Pending      [Stitch] 🗑 │
│                       ├──────────────────────────────────────────────────────────────────────┤
│ ───────────────────── │  ...                                                                 │
│ Selected Account:     │                                                                      │
│ [ Sign In ]           │                                                                      │
│ [ Chrome Cookies ]    │                                                                      │
│                       │                                                                      │
│ ───────────────────── ├──────────────────────────────────────────────────────────────────────┤
│ [☀ Light | ☾ Dark|Auto]│  ▸ Activity Log · Idle · 2 events                  [Clear] [Copy]   │
│ [⚙ Settings]          │  (expands up to 220px; collapsed by default until opened or error)   │
└───────────────────────┴──────────────────────────────────────────────────────────────────────┘
```

### Why This Layout Feels Commercial & Polished
- **Zero toolbar crowding**: Account switching is 1 click in the sidebar instead of a cramped `<select>` + separate `Accounts` modal.
- **Immediate Chrome Cookie access**: When an account is not signed in, an inline subtle callout strip appears inside the workspace header (and in the sidebar card) offering one-click **Sign In with Browser** or **Import from Chrome** (which opens the guided instructions modal).
- **1-click Light Mode**: A sleek 3-segment theme pill (`Light` / `Dark` / `System`) sits cleanly in the sidebar footer, syncing with macOS/Windows `nativeTheme` and persisting to `settings.json`.
- **Works cleanly at `940×640` and up**: Sidebar is `236px` fixed (`flex-shrink: 0`), workspace takes `1fr` (`min-width: 0`), table scrolls cleanly without clipping any button.

---

## 2. Phase 1 — Core Package (`packages/core`)

### 2.1 Theme Setting (`packages/core/src/types.ts` & `packages/core/src/settings.ts`)
1. In `packages/core/src/types.ts`:
   - Add `export type ThemeMode = 'system' | 'light' | 'dark'`
   - Add `theme?: ThemeMode` to `export interface Settings` (keep optional on the type so any raw `Settings` test objects don't break, while `DEFAULT_SETTINGS` sets `theme: 'system'`).
2. In `packages/core/src/settings.ts`:
   - Update `DEFAULT_SETTINGS`:
     ```ts
     export const DEFAULT_SETTINGS: Settings = {
       defaultAccount: 'main',
       headless: true,
       browserPath: '',
       maxScheduleDays: 10,
       visibility: 'everyone',
       aiLabel: true,
       theme: 'system'
     }
     ```

### 2.2 Auto-Generated Internal Account IDs (`packages/core/src/profiles.ts`)
Keep `addAccount(id: string, label?: string): Account` untouched for CLI and test compatibility. Add below it:

```ts
/**
 * Builds a filesystem-safe, unique internal account id from a display label.
 * Always satisfies assertAccountId (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/).
 */
export function generateAccountId(label: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds)
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  const base = slug && /^[a-z0-9]/.test(slug) ? slug : 'account'
  if (!taken.has(base)) return base

  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/** Creates a new account from a user-facing label, auto-generating its internal id. */
export function createAccount(label: string): Account {
  const clean = label.trim()
  if (!clean) throw new Error('Account name is required')
  const existing = listAccounts().map((account) => account.id)
  const id = generateAccountId(clean, existing)
  return addAccount(id, clean)
}
```
*(Automatically exported via `export * from './profiles'` in `packages/core/src/index.ts`.)*

### 2.3 Chrome Cookie Parsing (`packages/core/src/cookies.ts`)
Keep all existing exports untouched. Add these helpers and exported functions at the bottom of `packages/core/src/cookies.ts`:

```ts
function normalizeSameSite(value: unknown): StoredCookie['sameSite'] | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict'
    case 'lax':
      return 'Lax'
    case 'none':
    case 'no_restriction':
      return 'None'
    default:
      return undefined
  }
}

function isTikTokDomain(domain: string | undefined): boolean {
  if (!domain) return false
  const clean = domain.trim().toLowerCase().replace(/^\./, '')
  return clean === 'tiktok.com' || clean.endsWith('.tiktok.com')
}

/**
 * Parses JSON cookie arrays exported by Chrome extensions (Cookie-Editor,
 * EditThisCookie, Chrome DevTools / Playwright). Filters to tiktok.com if mixed.
 */
export function parseJsonCookies(text: string): StoredCookie[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const parsed: StoredCookie[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue

    const value = typeof item.value === 'string' ? item.value : String(item.value ?? '')
    const domain =
      typeof item.domain === 'string' && item.domain.trim() ? item.domain.trim() : '.tiktok.com'
    const path =
      typeof item.path === 'string' && item.path.trim() ? item.path.trim() : '/'

    const cookie: StoredCookie = { name, value, domain, path }
    const rawExpiry = item.expires ?? item.expirationDate
    const expiry = Number(rawExpiry)
    if (Number.isFinite(expiry) && expiry > 0) cookie.expires = Math.floor(expiry)
    if (item.httpOnly) cookie.httpOnly = true
    if (item.secure) cookie.secure = true
    const sameSite = normalizeSameSite(item.sameSite)
    if (sameSite) cookie.sameSite = sameSite

    parsed.push(cookie)
  }

  const tiktokOnly = parsed.filter((cookie) => isTikTokDomain(cookie.domain))
  return tiktokOnly.length > 0 ? tiktokOnly : parsed
}

/**
 * Parses a raw `Cookie:` request header or `name=value; ...` string copied from
 * Chrome DevTools Network tab. Synthesizes `sessionid_ss` if only `sessionid` is present.
 */
export function parseCookieHeader(text: string): StoredCookie[] {
  const cleaned = text.trim().replace(/^cookie\s*:\s*/i, '')
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  const cookies: StoredCookie[] = []

  for (const segment of cleaned.split(/[;\r\n]+/)) {
    const part = segment.trim()
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!name || /\s/.test(name)) continue
    cookies.push({ name, value, domain: '.tiktok.com', path: '/', secure: true, expires })
  }

  const sid = cookies.find((c) => c.name === 'sessionid' && c.value)?.value
  if (sid && !cookies.some((c) => c.name === 'sessionid_ss')) {
    cookies.push({ name: 'sessionid_ss', value: sid, domain: '.tiktok.com', path: '/', secure: true, expires })
  }
  return cookies
}

/**
 * Auto-detects any supported Chrome cookie format:
 * 1. JSON cookie array (Cookie-Editor / EditThisCookie)
 * 2. Netscape cookies.txt (Get cookies.txt LOCALLY)
 * 3. Cookie header or `sessionid=...` pairs
 * 4. Bare `sessionid` token copied from Chrome DevTools -> Application -> Cookies
 */
export function parseCookieInput(text: string): StoredCookie[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return parseJsonCookies(trimmed)

  const netscape = parseNetscape(trimmed)
  if (netscape.length > 0) return netscape

  if (trimmed.includes('=')) {
    const header = parseCookieHeader(trimmed)
    if (header.length > 0) return header
  }

  if (!/\s/.test(trimmed) && trimmed.length >= 8) {
    return sessionIdToCookies(trimmed)
  }

  return []
}
```
*(Automatically exported via `export * from './cookies'` in `packages/core/src/index.ts`.)*

### 2.4 Immediate Session Verification on Cookie Import (`packages/core/src/uploader/auth.ts` & `packages/core/src/index.ts`)
1. In `packages/core/src/uploader/auth.ts`, update `inspectAccount()` (lines 202–208) so `cookies.txt` is injected if `checkSession(page)` is initially false:
   ```ts
   const { page, context, close } = launched
   try {
     let signedIn = await checkSession(page)
     if (!signedIn) {
       const fallback = cookiesPath(accountId)
       if (existsSync(fallback)) {
         const cookies = parseNetscape(await readFile(fallback, 'utf8'))
         if (cookies.length > 0) {
           await context.addCookies(toPlaywrightCookies(cookies) as unknown as Cookie[])
           signedIn = await checkSession(page)
         }
       }
     }
     return {
       signedIn,
       message: signedIn ? 'Signed in' : `Not signed in. Run: tiktok-up login --account ${accountId}`
     }
   } catch (error) {
   ```
2. Add `applyImportedCookies()` in `packages/core/src/uploader/auth.ts`:
   ```ts
   /**
    * Replaces cookies in the account's persistent browser profile with imported cookies
    * and verifies immediately whether TikTok recognizes the session.
    */
   export async function applyImportedCookies(
     accountId: string,
     cookies: StoredCookie[],
     options: { browserPath?: string; source?: string } = {}
   ): Promise<AuthStatus> {
     try {
       acquireLock(accountId, options.source ?? 'cookies-import')
     } catch (error) {
       return {
         signedIn: false,
         message: (error as Error).message,
         ...(error instanceof LockBusyError ? { locked: true } : {})
       }
     }

     let launched: Awaited<ReturnType<typeof launchContext>>
     try {
       launched = await launchContext({
         userDataDir: browserProfileDir(accountId),
         headless: true,
         browserPath: options.browserPath
       })
     } catch (error) {
       releaseLock(accountId)
       return { signedIn: false, message: (error as Error).message }
     }

     const { page, context, close } = launched
     try {
       await context.clearCookies()
       await context.addCookies(toPlaywrightCookies(cookies) as unknown as Cookie[])
       const signedIn = await checkSession(page)
       return {
         signedIn,
         message: signedIn
           ? `Imported ${cookies.length} cookie(s) and verified sign-in`
           : `Imported ${cookies.length} cookie(s), but TikTok did not accept the session. Make sure you are signed in to tiktok.com in Chrome and copied a valid sessionid.`
       }
     } catch (error) {
       return { signedIn: false, message: (error as Error).message }
     } finally {
       releaseLock(accountId)
       await closeBrowser(close)
     }
   }
   ```
3. In `packages/core/src/index.ts`, add `applyImportedCookies` to the named export block from `'./uploader/auth'`.

### 2.5 Unit Tests (`packages/core/tests/cookies.test.ts` & `packages/core/tests/profiles.test.ts`)
1. **`packages/core/tests/cookies.test.ts`**:
   - Test `parseJsonCookies` with Cookie-Editor JSON (`expirationDate` float → floored `expires`, `sameSite: 'no_restriction'` → `'None'`, `'lax'` → `'Lax'`, `'strict'` → `'Strict'`, `'unspecified'` → `undefined`, mixed domains filtered to TikTok, invalid JSON returns `[]`).
   - Test `parseCookieHeader` with `Cookie: a=1; sessionid=xyz123; token=a=b`, verifying `=` in values is preserved and `sessionid_ss` is synthesized only when missing.
   - Test `parseCookieInput` auto-detecting JSON, Netscape, `Cookie:` header, bare `sessionid` (`'0123456789abcdef'`), and rejecting empty/prose input (`'hello world'` → `[]`).
2. **`packages/core/tests/profiles.test.ts`**:
   - Test `generateAccountId` and `createAccount`: slug generation (`'Brand Main!'` → `'brand-main'`), collision suffixing (`'brand-main-2'`), non-ASCII fallback (`'🚀'` → `'account'`), blank label throws.

---

## 3. Phase 2 — Desktop Main & Preload (`packages/desktop/src/main`, `packages/desktop/src/preload`)

### 3.1 `packages/desktop/src/main/index.ts`
- Import `nativeTheme` from `'electron'` and `loadSettings` from `'@tiktok-uploader/core'`.
- Define:
  ```ts
  const LIGHT_BG = '#f5f6f8'
  const DARK_BG = '#0f1014'

  function resolveBg(theme?: 'system' | 'light' | 'dark'): string {
    if (theme === 'light') return LIGHT_BG
    if (theme === 'dark') return DARK_BG
    return nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG
  }
  ```
- In `app.whenReady().then(...)`, set `nativeTheme.themeSource = loadSettings().theme ?? 'system'` BEFORE calling `createWindow()`.
- In `createWindow()`, set `backgroundColor: resolveBg(loadSettings().theme)`.
- Keep `minWidth: 940`, `minHeight: 640`, `width: 1240`, `height: 820`.

### 3.2 `packages/desktop/src/main/ipc.ts`
1. Import `nativeTheme` from `'electron'`, plus `applyImportedCookies`, `createAccount`, `parseCookieInput`, `sessionIdOf` from `'@tiktok-uploader/core'`.
2. Add label helper so no user-facing message leaks internal IDs:
   ```ts
   const accountLabel = (accountId: string): string =>
     listAccounts().find((a) => a.id === accountId)?.label ?? 'Account'
   ```
3. In `settings:set`:
   ```ts
   ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
     const next = saveSettings(patch)
     if (patch.theme) {
       nativeTheme.themeSource = next.theme ?? 'system'
       const win = getWindow()
       if (win && !win.isDestroyed()) {
         const dark = next.theme === 'dark' || (next.theme !== 'light' && nativeTheme.shouldUseDarkColors)
         win.setBackgroundColor(dark ? '#0f1014' : '#f5f6f8')
       }
     }
     return next
   })
   ```
4. In `accounts:add`:
   ```ts
   ipcMain.handle('accounts:add', (_event, input: { id?: string; label: string }) => {
     const account = input.id?.trim()
       ? addAccount(input.id.trim(), input.label)
       : createAccount(input.label)
     signedIn.set(account.id, signedIn.get(account.id) ?? false)
     return summarize(account)
   })
   ```
5. Add shared cookie import & verification helper inside `registerIpc`:
   ```ts
   async function saveAndVerifyCookies(
     accountId: string,
     rawText: string
   ): Promise<{ ok: boolean; signedIn: boolean; count: number; message: string }> {
     const cookies = parseCookieInput(rawText)
     if (cookies.length === 0) {
       return {
         ok: false,
         signedIn: false,
         count: 0,
         message: 'No valid cookies detected. Paste your sessionid from Chrome DevTools, or a JSON / Netscape export.'
       }
     }
     if (!sessionIdOf(cookies)) {
       return {
         ok: false,
         signedIn: false,
         count: cookies.length,
         message: 'No "sessionid" cookie found. Make sure you are logged in to tiktok.com in Chrome before exporting.'
       }
     }

     const target = cookiesPath(accountId)
     await mkdir(dirname(target), { recursive: true, mode: 0o700 })
     await writeFile(target, serializeNetscape(cookies), { encoding: 'utf8', mode: 0o600 })
     if (process.platform !== 'win32') chmodSync(target, 0o600)

     const status = await applyImportedCookies(accountId, cookies, {
       browserPath: loadSettings().browserPath,
       source: 'desktop'
     })
     signedIn.set(accountId, status.signedIn)
     return {
       ok: status.signedIn,
       signedIn: status.signedIn,
       count: cookies.length,
       message: status.message
     }
   }
   ```
6. Update `auth:import-cookies` (accepts `.txt` and `.json`) and add `auth:import-cookies-text`:
   ```ts
   ipcMain.handle('auth:import-cookies', async (_event, accountId: string) => {
     try {
       const picked = await showOpen({
         title: 'Import Chrome cookies (.txt or .json)',
         properties: ['openFile'],
         filters: [{ name: 'Cookie files', extensions: ['txt', 'json'] }]
       })
       const file = picked.filePaths[0]
       if (picked.canceled || !file) return { ok: false, canceled: true, message: 'Cancelled' }
       return await saveAndVerifyCookies(accountId, await readFile(file, 'utf8'))
     } catch (error) {
       return { ok: false, message: `Cookie import failed: ${errorMessage(error)}` }
     }
   })

   ipcMain.handle(
     'auth:import-cookies-text',
     async (_event, input: { accountId: string; text: string }) => {
       try {
         return await saveAndVerifyCookies(input.accountId, input.text)
       } catch (error) {
         return { ok: false, message: `Cookie import failed: ${errorMessage(error)}` }
       }
     }
   )
   ```
7. Update `auth:export-cookies` `defaultPath` (`cookies-${safeSlugOfLabel}.txt`) and `queue:start` error/log messages to use `accountLabel(accountId)` instead of raw `accountId`.

### 3.3 `packages/desktop/src/preload/index.d.ts` & `packages/desktop/src/preload/index.ts`
Add `ImportCookiesResult` type and keep both files strictly synchronized:
```ts
export interface ImportCookiesResult {
  ok: boolean
  signedIn?: boolean
  canceled?: boolean
  count?: number
  message: string
}
```
Update `accounts.add` to accept `{ id?: string; label: string }` and add `auth.importCookiesText(input: { accountId: string; text: string }): Promise<ImportCookiesResult>`.

---

## 4. Phase 3 — Visual Design System (`index.html` & `styles.css`)

### 4.1 `packages/desktop/src/renderer/index.html`
Change line 10 to:
```html
<meta name="color-scheme" content="light dark" />
```

### 4.2 Exact CSS Tokens & Studio Polish Rules (`packages/desktop/src/renderer/src/styles.css`)

Use these exact palettes — both are tuned for WCAG AA contrast, soft surface elevation, crisp hairline borders, and effortless Light/Dark switching:

```css
:root,
[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0f1014;
  --sidebar-bg: #14151b;
  --surface: #1a1b23;
  --surface-2: #22242e;
  --surface-3: #2b2d3a;
  --row-hover: rgba(255, 255, 255, 0.025);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --border-hover: rgba(255, 255, 255, 0.24);
  --text: #f1f2f6;
  --text-secondary: #b8bcc9;
  --muted: #848899;
  --brand: #fe2c55;
  --brand-hover: #e5234a;
  --brand-soft: rgba(254, 44, 85, 0.14);
  --brand-border: rgba(254, 44, 85, 0.38);
  --accent: #25f4ee;
  --accent-soft: rgba(37, 244, 238, 0.11);
  --accent-border: rgba(37, 244, 238, 0.32);
  --green: #34d399;
  --green-soft: rgba(52, 211, 153, 0.12);
  --green-border: rgba(52, 211, 153, 0.34);
  --amber: #fbbf24;
  --amber-soft: rgba(251, 191, 36, 0.12);
  --amber-border: rgba(251, 191, 36, 0.36);
  --danger-text: #ff8097;
  --danger-soft: rgba(254, 44, 85, 0.12);
  --danger-soft-hover: rgba(254, 44, 85, 0.22);
  --danger-border: rgba(254, 44, 85, 0.38);
  --focus-ring: 0 0 0 3px rgba(37, 244, 238, 0.22);
  --overlay-bg: rgba(7, 8, 12, 0.62);
  --drop-bg: rgba(15, 16, 20, 0.82);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.24);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.28);
  --shadow-modal: 0 24px 64px rgba(0, 0, 0, 0.56);
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

[data-theme='light'] {
  color-scheme: light;
  --bg: #f5f6f8;
  --sidebar-bg: #eef0f4;
  --surface: #ffffff;
  --surface-2: #f3f4f7;
  --surface-3: #e8eaef;
  --row-hover: rgba(15, 23, 42, 0.024);
  --border: rgba(15, 23, 42, 0.09);
  --border-strong: rgba(15, 23, 42, 0.16);
  --border-hover: rgba(15, 23, 42, 0.28);
  --text: #111318;
  --text-secondary: #3f4554;
  --muted: #656d7e;
  --brand: #e61e4d;
  --brand-hover: #cc1742;
  --brand-soft: rgba(230, 30, 77, 0.09);
  --brand-border: rgba(230, 30, 77, 0.28);
  --accent: #0d9488;
  --accent-soft: rgba(13, 148, 136, 0.1);
  --accent-border: rgba(13, 148, 136, 0.3);
  --green: #15803d;
  --green-soft: rgba(21, 128, 61, 0.09);
  --green-border: rgba(21, 128, 61, 0.28);
  --amber: #b45309;
  --amber-soft: rgba(217, 119, 6, 0.1);
  --amber-border: rgba(217, 119, 6, 0.3);
  --danger-text: #be123c;
  --danger-soft: rgba(225, 29, 72, 0.08);
  --danger-soft-hover: rgba(225, 29, 72, 0.15);
  --danger-border: rgba(225, 29, 72, 0.3);
  --focus-ring: 0 0 0 3px rgba(13, 148, 136, 0.2);
  --overlay-bg: rgba(15, 23, 42, 0.38);
  --drop-bg: rgba(245, 246, 248, 0.88);
  --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-sm: 0 2px 8px rgba(15, 23, 42, 0.08);
  --shadow-modal: 0 24px 60px rgba(15, 23, 42, 0.18);
}
```

### Mandatory CSS Polish Details (Implement Every One)
1. **App Shell (`.shell`)**:
   - `display: grid; grid-template-columns: 236px minmax(0, 1fr); height: 100vh; width: 100vw; overflow: hidden;`
   - Left pane `.sidebar`: `background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0;`
   - Right pane `.workspace`: `background: var(--bg); display: flex; flex-direction: column; min-width: 0; min-height: 0;`
2. **Custom Thin Scrollbars**:
   ```css
   ::-webkit-scrollbar { width: 7px; height: 7px; }
   ::-webkit-scrollbar-track { background: transparent; }
   ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
   ::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
   ```
3. **Custom Toggle Switch (`.switch`)**:
   - Track: `width: 32px; height: 18px; border-radius: 999px; background: var(--surface-3); border: 1px solid var(--border-strong); position: relative; transition: background 150ms ease, border-color 150ms ease;`
   - Checked track: `background: var(--brand); border-color: var(--brand);`
   - Thumb: `width: 12px; height: 12px; border-radius: 50%; background: #fff; position: absolute; top: 2px; left: 2px; transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 1px 2px rgba(0,0,0,0.25);`
   - Checked thumb: `transform: translateX(14px);`
4. **Interactive Toggle Pills (`.option-pill`)** for per-video `Draft`, `AI`, `Comment`, `Duet`, `Stitch`:
   - `display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 500; border: 1px solid var(--border-strong); background: var(--surface); color: var(--muted); cursor: pointer; transition: all 120ms ease;`
   - Active state (`.option-pill[aria-pressed='true']`): `background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent);`
   - Special Draft active state (`.option-pill.draft[aria-pressed='true']`): `background: var(--amber-soft); border-color: var(--amber-border); color: var(--amber);`
   - Wrap them in `.option-pills { display: flex; flex-wrap: wrap; gap: 5px; }` — compact, scannable, tactile!
5. **Custom Styled `<select>`**:
   - `appearance: none; padding-right: 26px;` with a subtle inline SVG chevron background (`background-position: right 8px center; background-repeat: no-repeat;`) or wrapper icon.
6. **Buttons & Hierarchy**:
   - `.btn`: `height: 32px; padding: 0 12px; border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;`
   - Active press feedback: `.btn:active:not(:disabled) { transform: scale(0.98); }`
   - `.btn.primary`: `background: var(--brand); border-color: transparent; color: #fff; font-weight: 600;`
   - `.btn.ghost`: `background: transparent; border-color: transparent; box-shadow: none; color: var(--text-secondary);` -> hover `background: var(--surface-2); color: var(--text);`
   - `.btn.sm`: `height: 28px; padding: 0 10px; font-size: 12px;`
   - `.btn.danger`: `background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger-text); box-shadow: none;`
7. **Sidebar Account List**:
   - Each `.account-item` is a sleek `36px` rounded button (`border-radius: var(--radius-sm); padding: 0 10px; display: flex; align-items: center; gap: 9px;`), with an `8px` status dot (`.status-dot.ok` green, `.status-dot.locked` amber, `.status-dot.off` muted) and truncated bold-when-active label.
   - Selected `.account-item.active`: `background: var(--surface); box-shadow: var(--shadow-xs); color: var(--text); font-weight: 600;` (looks crisp and native on both Light and Dark sidebars!).
   - Subtle hover edit/more actions or selected-account card right below the list with **Sign In**, **Chrome Cookies**, **Export**, **Rename**, and **Remove** buttons.
8. **3-Segment Theme Switcher (`.segmented`)**:
   - Container: `display: grid; grid-template-columns: repeat(3, 1fr); padding: 3px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); gap: 2px;`
   - Active segment: `background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); font-weight: 600;`
9. **Queue Card-Table Surface**:
   - Wrap the queue table inside a floating surface container (`.queue-surface`, `margin: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); overflow: hidden;`) so the table sits on an elevated card over the subtle `--bg` canvas — this single move makes Light Mode look dramatically more professional!
   - Caption textarea inside table rows: clean subtle border `border: 1px solid transparent; background: var(--surface-2);` becoming `background: var(--surface); border-color: var(--accent); box-shadow: var(--focus-ring);` on focus.
   - Tabular numbers (`font-variant-numeric: tabular-nums;`) on character counters, schedule dates, stats strip, and log timestamps.
10. **Live Run Progress Bar**:
    - `.run-progress` (`height: 3px; background: var(--surface-3); overflow: hidden;`) with `.run-progress-fill` (`background: var(--brand); transition: width 300ms ease;`).
11. **Modals & Toasts**:
    - `.overlay`: `backdrop-filter: blur(5px); background: var(--overlay-bg); animation: fadeIn 120ms ease;`
    - `.modal`: `border-radius: var(--radius-lg); box-shadow: var(--shadow-modal); animation: modalIn 150ms cubic-bezier(0.16, 1, 0.3, 1);`
    - `.toast-stack`: fixed `bottom: 48px; right: 20px; z-index: 80; display: flex; flex-direction: column; gap: 8px;`
    - `.toast`: `background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 10px 14px; box-shadow: var(--shadow-sm); display: flex; align-items: center; gap: 8px; font-size: 12.5px; max-width: 360px;` with colored left indicator dot (`ok` / `error` / `info`).
12. **Chrome Cookie Import Modal Styles**:
    - `.steps-card`: `background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;`
    - `.steps-list`: custom numbered circle badges (`20×20` circle with `--brand-soft` background and `--brand` number) next to each clear instruction step!
    - `<kbd>`: crisp keycap styling (`padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: ui-monospace, monospace; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 1px 0 var(--border-strong);`).

---

## 5. Phase 4 — Modular Renderer Components (`packages/desktop/src/renderer/src/`)

Break `App.tsx` into clean, focused files so every component is easy to read, edit, and verify:

### 5.1 `packages/desktop/src/renderer/src/utils.ts`
Export:
- Constants: `SOFT_LIMIT = 150`, `HARD_LIMIT = 2200`, `MIN_LEAD_MINUTES = 20`, `VISIBILITIES`, `STATUS_LABEL`, `VIDEO_EXT`
- Types: `LogLine`, `ToastItem = { id: string; message: string; tone: 'info' | 'ok' | 'error' }`
- Pure functions: `localInput`, `isoToLocal`, `localToIso`, `stamp`, `baseName`, `fileExt`, `stem`, `errText`, `newJob`, `formatWhen`
- `validateRowSchedule(iso: string | null, maxScheduleDays: number): { level: 'error' | 'warn'; text: string } | null`:
  - Returns `{ level: 'error', text: 'Must be at least 20 min ahead' }` if `< now + 20m`.
  - Returns `{ level: 'error', text: \`Exceeds ${maxScheduleDays}-day limit\` }` if `> now + maxScheduleDays`.
  - Returns `{ level: 'warn', text: 'Will round to 5-min mark' }` if `minutes % 5 !== 0`.
  - Otherwise `null`.
- `detectCookieFormat(raw: string): string | null`:
  - `trimmed.startsWith('[')` → `'JSON cookies'`
  - Contains `\t` with 7+ fields → `'Netscape cookies.txt'`
  - Contains `=` → `'Cookie header'`
  - Single non-whitespace token length ≥ 8 → `'sessionid token'`
  - Otherwise `null`.

### 5.2 `packages/desktop/src/renderer/src/components/Icons.tsx`
Uniform `16×16` (or configurable `size` prop, default `15`) inline SVG icons with `stroke="currentColor"`, `strokeWidth="1.75"`, `strokeLinecap="round"`, `strokeLinejoin="round"`, `fill="none"`:
- `SunIcon`, `MoonIcon`, `MonitorIcon`
- `SettingsIcon`, `TrashIcon`, `CloseIcon`, `PlusIcon`, `FolderIcon`, `FilmIcon`
- `CalendarIcon`, `CookieIcon` (or `KeyIcon`), `LogInIcon`, `DownloadIcon`, `EditIcon`
- `PlayIcon`, `StopIcon`, `RefreshIcon`, `CheckIcon`, `AlertIcon`, `ChevronRightIcon`, `ChevronDownIcon`, `CopyIcon`, `UploadCloudIcon`

### 5.3 `packages/desktop/src/renderer/src/components/ToggleSwitch.tsx`
Accessible switch component (`role="switch"`, `aria-checked={checked}`) used for `Show browser`, `Run headless`, and `Default AI label`.

### 5.4 `packages/desktop/src/renderer/src/components/Modal.tsx`
Reusable modal with `title`, optional `subtitle`, `size?: 'sm' | 'md' | 'lg'`, `CloseIcon` button, Escape-to-close, backdrop-click-to-close, smooth entrance animation.

### 5.5 `packages/desktop/src/renderer/src/components/ConfirmDialog.tsx`
Styled replacement for `window.confirm()`!
Props: `title`, `description`, `confirmLabel`, `danger?: boolean`, `busy?: boolean`, `onConfirm`, `onCancel`.
Used when deleting an account (`Remove "${account.label}"?`) so there are ZERO native browser alert/confirm popups anywhere in the app.

### 5.6 `packages/desktop/src/renderer/src/components/AccountChip.tsx`
Displays status pill with colored status dot:
- `Checking…` (subtle animated pulse dot)
- `Locked by CLI` (amber)
- `Signed in` (green)
- `Not signed in` (muted/rose)

### 5.7 `packages/desktop/src/renderer/src/components/JobRow.tsx`
Props: `job`, `maxScheduleDays`, `onChange`, `onRemove`.
- **Video Cell**: `36×36` `.video-thumb` icon badge (`FilmIcon`) + bold `baseName(job.videoPath)` (full path on hover tooltip) + subtle `.ext-tag` (e.g. `MP4`). **NO `job.id` rendered!**
- **Caption Cell**: Clean textarea + bottom row with character count (`tabular-nums`), soft warning pill over 150 chars, red error over 2,200 chars.
- **Schedule Cell**: Datetime input + inline clear `CloseIcon` button when set + formatted time OR inline `validateRowSchedule` error/warning badge.
- **Settings Cell (Visibility + Options)**:
  - Compact styled `<select>` for `Everyone` / `Friends` / `Private`.
  - Below it, `.option-pills` row of 5 tactile pill toggles (`Draft`, `AI`, `Comment`, `Duet`, `Stitch`) with `aria-pressed` and `CheckIcon` when active. *(Combining Visibility + Options into one clean column or keeping them neatly aligned makes rows dramatically cleaner and easier to scan at `940px` width!)*
- **Status & Remove Cell**:
  - Dot-prefixed status pill (`● Pending`, `● Running`, `● Done`, `● Failed` + clickable `Screenshot` link button).
  - Subtle `TrashIcon` button (`disabled={job.status === 'running'}`) to remove the row cleanly.

### 5.8 `packages/desktop/src/renderer/src/components/ImportCookiesModal.tsx`
Dedicated **Import Cookies from Chrome** modal (`size="lg"`):
- **Header**: `Import Cookies from Chrome` · subtitle: `Account: ${account.label}` (label only!).
- **2-Tab Segmented Switcher**:
  - **Method 1: Chrome DevTools (Fastest · No Extension)**
  - **Method 2: Chrome Extension (JSON or .txt)**
- **Numbered Step-by-Step Instructions Card (`.steps-card`)**:
  - **Tab 1 (Chrome DevTools)**:
    1. Open **tiktok.com** in Google Chrome and make sure you are signed in.
    2. Press <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>I</kbd> (Mac) or <kbd>F12</kbd> (Windows / Linux) to open DevTools.
    3. Select the **Application** tab at the top (click `»` if it isn't visible).
    4. In the left sidebar, expand **Cookies** and click **https://www.tiktok.com**.
    5. Find the cookie named **`sessionid`**, copy its **Value**, and paste it below.
  - **Tab 2 (Chrome Extension)**:
    1. Install **Cookie-Editor** or **Get cookies.txt LOCALLY** from the Chrome Web Store.
    2. While logged in to **tiktok.com**, click the extension icon in Chrome's toolbar.
    3. Click **Export** → choose **JSON** (Cookie-Editor) or **Netscape `.txt`** (Get cookies.txt LOCALLY).
    4. Paste the exported cookies below, **or** click **Import from File (.txt / .json)**.
- **Paste Area**:
  - Header label + live format detection badge (`detectCookieFormat(rawText)`).
  - Monospace `<textarea>` for pasting `sessionid`, `Cookie:` header, JSON array, or Netscape `.txt`.
  - Privacy note: *"Stored locally on your computer with private permissions (0600)."*
- **Inline Feedback Alert**: Shows green verified banner or clear red error banner inside the modal.
- **Footer**:
  - Left: **Import from File (.txt / .json)** button (calls `window.api.auth.importCookies(account.id)`).
  - Right: **Close** + primary **Import & Verify** button (calls `window.api.auth.importCookiesText({ accountId: account.id, text: rawText })`).

### 5.9 `packages/desktop/src/renderer/src/components/AddAccountModal.tsx` (or Inline Add Form in Sidebar + Account Actions)
- **Single input**: `Account name` (placeholder `e.g. Brand Main`, `autoFocus`).
- **NO account ID field anywhere!**
- Calls `window.api.accounts.add({ label: name.trim() })`, auto-selects the new account, and shows a toast (`Added "Brand Main"`).
- Also include a clean **Rename Account** modal (single input prefilled with `account.label`, calls `window.api.accounts.label({ id: account.id, label })`).

### 5.10 `packages/desktop/src/renderer/src/components/BulkModal.tsx`
- Clean 2-column form grid with `Start`, `Every`, `Jitter (optional)`, `Quiet window (optional)`.
- Quick preset chips under `Every`: `6h`, `12h`, `1d`, `2d`.
- Live numbered schedule preview list with `tabular-nums`.

### 5.11 `packages/desktop/src/renderer/src/components/ConfirmModal.tsx`
- Label-only account display (`account.label` + `<AccountChip>`).
- Clean key-value summary grid + validation alerts:
  - Blocks `Run` with a red alert if any caption exceeds 2,200 characters.
  - Shows amber warning if any job has an invalid schedule or empty caption, or if the account is not signed in.

### 5.12 `packages/desktop/src/renderer/src/components/SettingsModal.tsx`
- **Appearance**: 3-segment Theme selector (`Light` / `Dark` / `System`).
- **Browser**: `Run headless` (`ToggleSwitch`), `Browser path` input.
- **Upload Defaults**: `Schedule horizon` (`10 days` / `30 days`), `Default visibility` (`Everyone` / `Friends` / `Private`), `Default AI label` (`ToggleSwitch`).

### 5.13 `packages/desktop/src/renderer/src/components/ToastStack.tsx`
- Renders subtle auto-dismissing toasts (`3.5s` timeout) at bottom-right with colored status icon and dismiss button.

### 5.14 `packages/desktop/src/renderer/src/App.tsx`
- Wires:
  - Theme state (`settings.theme ?? 'system'` + `matchMedia('(prefers-color-scheme: dark)')` listener → sets `document.documentElement.dataset.theme`).
  - **Left Sidebar**:
    - Brand header (custom red-cyan subtle mark + `TikTok Uploader`).
    - Accounts header (`ACCOUNTS` + `+` button to add account).
    - Account list (clickable label-only items with status dots).
    - Selected Account quick panel (shows selected account's actions: **Sign In**, **Chrome Cookies**, **Export**, **Rename**, **Delete** — delete opens `ConfirmDialog`, never `window.confirm`).
    - Sidebar footer: 3-segment **Light / Dark / System** theme switcher + **Settings** button.
  - **Main Workspace**:
    - **Workspace Header**: Selected account label (`18px` semibold) + `<AccountChip>` + quick **Import Chrome Cookies** button when not signed in + `Show browser` `ToggleSwitch` + primary **Run** / **Stop** button.
    - **Progress Bar**: Visible when `running === true`.
    - **Sub-toolbar**: `Add Videos`, `Add Folder`, `Bulk Schedule`, `Retry Failed` (when failed > 0), `Clear Finished` (when finished > 0), and right-aligned tabular queue stats (`N videos · N scheduled · N done · N failed`).
    - **Queue Area**:
      - When no accounts exist: welcoming **Onboarding Empty Card** with **Create Your First Account** CTA.
      - When account exists & queue empty: elevated **Drag & Drop Empty Card** with `UploadCloudIcon`, **Add Videos** + **Add Folder** buttons, and a helpful *"Need to connect this account? Sign In or Import Chrome Cookies"* link bar if not signed in.
      - When queue has items: elevated `.queue-surface` card containing the clean table of `<JobRow>`s.
    - **Collapsible Activity Log Drawer**:
      - Defaults to **collapsed** (`logOpen = false`) so the workspace feels spacious and calm; shows live status pill + event count + red error badge when errors occur; expands cleanly with **Clear** and **Copy** buttons.
    - **Drag-over Overlay**: Smooth blurred dropzone card when dragging files/folders over the window.
    - **Toast Stack** + Modals (`AddAccountModal`, `RenameAccountModal`, `ConfirmDialog`, `ImportCookiesModal`, `BulkModal`, `ConfirmModal`, `SettingsModal`).
- **Log messages**: Always reference `account.label` and `baseName(job.videoPath)` — NEVER raw `accountId` or `jobId`.

---

## 6. Complete File Checklist

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `packages/core/src/types.ts` | Edit | Add `ThemeMode`, `theme?: ThemeMode` on `Settings` |
| 2 | `packages/core/src/settings.ts` | Edit | Default `theme: 'system'` |
| 3 | `packages/core/src/profiles.ts` | Edit | Add `generateAccountId()`, `createAccount()` |
| 4 | `packages/core/src/cookies.ts` | Edit | Add `parseJsonCookies()`, `parseCookieHeader()`, `parseCookieInput()` |
| 5 | `packages/core/src/uploader/auth.ts` | Edit | Fallback `cookies.txt` in `inspectAccount()`; add `applyImportedCookies()` |
| 6 | `packages/core/src/index.ts` | Edit | Export `applyImportedCookies` |
| 7 | `packages/core/tests/cookies.test.ts` | Edit | Unit tests for JSON, header, bare `sessionid`, auto-detect |
| 8 | `packages/core/tests/profiles.test.ts` | Edit | Unit tests for `generateAccountId()` and `createAccount()` |
| 9 | `packages/desktop/src/main/index.ts` | Edit | Theme-aware `nativeTheme.themeSource` and initial `backgroundColor` |
| 10 | `packages/desktop/src/main/ipc.ts` | Edit | Label-only `accounts:add`, `auth:import-cookies-text`, `.json`/`.txt` picker, immediate verification, theme background sync, label-only messages |
| 11 | `packages/desktop/src/preload/index.d.ts` | Edit | Sync IPC types (`ImportCookiesResult`, `accounts.add`, `auth.importCookiesText`) |
| 12 | `packages/desktop/src/preload/index.ts` | Edit | Expose `auth.importCookiesText` & updated `accounts.add` |
| 13 | `packages/desktop/src/renderer/index.html` | Edit | `<meta name="color-scheme" content="light dark" />` |
| 14 | `packages/desktop/src/renderer/src/styles.css` | Rewrite | Full Light + Dark design system, sidebar + workspace shell, switches, toggle pills, elevated cards, modals, toasts, custom scrollbars |
| 15 | `packages/desktop/src/renderer/src/utils.ts` | Create | Shared helpers, `validateRowSchedule`, `detectCookieFormat` |
| 16 | `packages/desktop/src/renderer/src/components/Icons.tsx` | Create | Crisp 1.75px-stroke SVG icon set |
| 17 | `packages/desktop/src/renderer/src/components/ToggleSwitch.tsx` | Create | Custom accessible pill switch |
| 18 | `packages/desktop/src/renderer/src/components/Modal.tsx` | Create | Animated modal dialog with backdrop blur |
| 19 | `packages/desktop/src/renderer/src/components/ConfirmDialog.tsx` | Create | Styled destructive confirmation modal (replaces `window.confirm`) |
| 20 | `packages/desktop/src/renderer/src/components/AccountChip.tsx` | Create | Dot-prefixed auth status badge |
| 21 | `packages/desktop/src/renderer/src/components/JobRow.tsx` | Create | Polished queue row with video badge, pill toggles, clear schedule, inline validation, remove button |
| 22 | `packages/desktop/src/renderer/src/components/ImportCookiesModal.tsx` | Create | Guided Chrome Cookie import modal (DevTools + Extension tabs, paste + file picker) |
| 23 | `packages/desktop/src/renderer/src/components/BulkModal.tsx` | Create | Bulk scheduler with `6h`/`12h`/`1d`/`2d` presets |
| 24 | `packages/desktop/src/renderer/src/components/ConfirmModal.tsx` | Create | Pre-run confirmation modal with validation warnings & label-only display |
| 25 | `packages/desktop/src/renderer/src/components/SettingsModal.tsx` | Create | Settings modal with Light/Dark/System theme switcher & toggle switches |
| 26 | `packages/desktop/src/renderer/src/components/ToastStack.tsx` | Create | Auto-dismissing feedback toast stack |
| 27 | `packages/desktop/src/renderer/src/App.tsx` | Rewrite | Clean top-level app composing sidebar, workspace, empty states, log drawer, toasts, and modals |

---

## 7. Verification Protocol (Run Every Check Before Calling Done)

### 7.1 Automated Checks
Run in this exact order from the repo root:
```bash
npm run typecheck
npm test
npm run build:cli
npm run build -w @tiktok-uploader/desktop
```
- **0 TypeScript errors** across core, cli, and desktop (`tsconfig.node.json` + `tsconfig.web.json`).
- **All tests pass** (existing 95 + new cookie & profile tests).
- **Zero leaked IDs or native browser prompts** — verify with ripgrep:
  ```bash
  rg "window\.confirm|window\.alert|file-id|account-id" packages/desktop/src/renderer/src
  ```
  Expected output: **0 matches**.

### 7.2 Visual & Usability Smoke Checklist (`npm run dev:desktop`)
- [ ] **First Impression**: Two-pane layout (sidebar + elevated workspace card), crisp SVG icons, zero raw checkboxes on video rows, smooth typography, calm collapsed log bar.
- [ ] **Light Mode & Dark Mode**: Click `Light`, `Dark`, and `Auto` in the sidebar footer — verify crisp contrast on every text label, button, input, pill, modal, and toast in both themes. Restart app and verify zero flash of wrong background color.
- [ ] **Label-Only Accounts**: Click `+` in sidebar → only an "Account name" field appears. Add `"Creator Main"`, rename it, confirm delete via the styled `ConfirmDialog` (no OS popup), check dropdowns/headers/logs — zero internal IDs visible anywhere.
- [ ] **Chrome Cookie Import**: Click **Chrome Cookies** → modal opens with numbered DevTools steps and Extension steps. Paste a `sessionid` or Cookie-Editor JSON → live format pill updates; click **Import & Verify** → writes `cookies.txt`, injects into browser profile, verifies session, updates status dot to green **Signed in**, and shows a success toast.
- [ ] **Queue Usability**: Resize window to `940×640` with zero clipped controls; add videos; toggle option pills (`Draft`, `AI`, `Comment`, `Duet`, `Stitch`); set & clear a row schedule; verify `< 20 min` inline schedule warning; delete a single row; test Bulk Schedule presets (`6h`, `12h`, `1d`, `2d`); expand and clear the Activity Log.
