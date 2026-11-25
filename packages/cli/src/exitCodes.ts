/** Exit codes are part of the CLI contract (docs/PLAN.md section 8). */
export enum ExitCode {
  Ok = 0,
  Unexpected = 1,
  Usage = 2,
  Auth = 3,
  LockBusy = 4,
  Partial = 5,
  AllFailed = 6
}

export interface QueueSummary {
  total: number
  done: number
  failed: number
  authRequired: boolean
  lockBusy: boolean
}

export const resolveExitCode = (result: QueueSummary): ExitCode => {
  if (result.authRequired) return ExitCode.Auth
  if (result.lockBusy) return ExitCode.LockBusy
  if (result.failed > 0 && result.done === 0) return ExitCode.AllFailed
  if (result.failed > 0) return ExitCode.Partial
  return ExitCode.Ok
}
