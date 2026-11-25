export * from './types'
export * from './paths'
export * from './settings'
export * from './profiles'
export * from './queue'
export * from './cookies'
export * from './schedule'
export * from './videos'
export * from './selectors'
export * from './utils'

// uploader/auth is exported selectively: both modules export AuthError-adjacent
// helpers under names that would collide with the rest of the surface.
export {
  AuthError,
  checkSession,
  assertSignedIn,
  ensureAuthenticated,
  loginInteractive,
  exportCookies,
  inspectAccount,
  applyImportedCookies,
  LockBusyError
} from './uploader/auth'
export { BrowserNotFoundError, launchContext } from './uploader/browser'
export type { LaunchContextOptions, LaunchedContext } from './uploader/browser'
export { loadLibrary, saveLibrary, parseCreatorApiPayload, syncAccountLibrary } from './uploader/library'
export type { RawLibraryItem, SyncLibraryResult } from './uploader/library'
export { uploadVideo, UploadError, isSupportedVideo } from './uploader/upload'
export type { UploadJob, Reporter } from './uploader/upload'
