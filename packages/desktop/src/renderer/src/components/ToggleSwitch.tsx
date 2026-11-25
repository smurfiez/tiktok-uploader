export interface ToggleSwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
  id?: string
}

export function ToggleSwitch({ checked, onChange, label, disabled, id }: ToggleSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
