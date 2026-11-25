import type { AccountSummary } from '@tiktok-uploader/core'

export interface AccountChipProps {
  account?: AccountSummary
  checking?: boolean
}

export function AccountChip({ account, checking }: AccountChipProps) {
  if (!account) {
    return <span className="chip">No account</span>
  }
  if (checking) {
    return (
      <span className="chip checking">
        <span className="status-dot checking" />
        Checking…
      </span>
    )
  }
  if (account.locked) {
    return (
      <span
        className="chip locked"
        title={account.lockSource ? `Locked by ${account.lockSource}` : 'Locked by another process'}
      >
        <span className="status-dot locked" />
        Locked by CLI
      </span>
    )
  }
  if (account.signedIn) {
    return (
      <span className="chip ok">
        <span className="status-dot ok" />
        Signed in
      </span>
    )
  }
  return (
    <span className="chip bad">
      <span className="status-dot bad" />
      Not signed in
    </span>
  )
}
