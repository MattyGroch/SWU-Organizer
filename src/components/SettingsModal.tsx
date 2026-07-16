import { useEffect, useRef, type RefObject } from 'react'
import type { AppSettings } from '../core/settings'

type SettingsModalProps = {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement>
}

export function SettingsModal({
  open,
  settings,
  onChange,
  onClose,
  returnFocusRef,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return

    dialogRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      returnFocusRef.current?.focus()
    }
  }, [onClose, open, returnFocusRef])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <h2 id="settings-title">Settings</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.autoOpenSinglePage}
            onChange={event =>
              onChange({ ...settings, autoOpenSinglePage: event.target.checked })
            }
          />
          <span>Automatically open enlarged page after selecting a card</span>
        </label>
        <div className="settings-modal-actions">
          <button type="button" className="tbtn" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  )
}
