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
    const returnFocusElement = returnFocusRef.current

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const dialog = dialogRef.current
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(element => element.tabIndex >= 0 && !element.hidden)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (!first || !last) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const activeElement = document.activeElement
      const focusIsOutside = !activeElement || !dialog.contains(activeElement)
      if (event.shiftKey && (activeElement === first || activeElement === dialog || focusIsOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || activeElement === dialog || focusIsOutside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      returnFocusElement?.focus()
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
