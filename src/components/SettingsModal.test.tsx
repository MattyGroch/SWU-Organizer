import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { SettingsModal } from './SettingsModal'

afterEach(cleanup)

describe('SettingsModal', () => {
  it('exposes settings accessibly and reports checkbox changes', () => {
    const onChange = vi.fn()

    render(
      <SettingsModal
        open
        settings={{ autoOpenSinglePage: true }}
        onChange={onChange}
        onClose={vi.fn()}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const checkbox = screen.getByRole('checkbox', {
      name: 'Automatically open enlarged page after selecting a card',
    })
    expect(document.activeElement).toBe(dialog)
    expect((checkbox as HTMLInputElement).checked).toBe(true)

    fireEvent.click(checkbox)

    expect(onChange).toHaveBeenCalledWith({ autoOpenSinglePage: false })
  })

  it('closes on Escape without leaking the key to global handlers', () => {
    const onClose = vi.fn()
    const globalKeyHandler = vi.fn()
    window.addEventListener('keydown', globalKeyHandler)

    render(
      <SettingsModal
        open
        settings={{ autoOpenSinglePage: true }}
        onChange={vi.fn()}
        onClose={onClose}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />,
    )

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(globalKeyHandler).not.toHaveBeenCalled()
    window.removeEventListener('keydown', globalKeyHandler)
  })

  it('closes with the button and restores focus when dismissed', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button ref={triggerRef}>Settings trigger</button>
        <SettingsModal
          open
          settings={{ autoOpenSinglePage: true }}
          onChange={vi.fn()}
          onClose={onClose}
          returnFocusRef={triggerRef}
        />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <>
        <button ref={triggerRef}>Settings trigger</button>
        <SettingsModal
          open={false}
          settings={{ autoOpenSinglePage: true }}
          onChange={vi.fn()}
          onClose={onClose}
          returnFocusRef={triggerRef}
        />
      </>,
    )

    expect(document.activeElement).toBe(triggerRef.current)
  })

  it('traps forward and reverse Tab movement inside the dialog', () => {
    render(
      <SettingsModal
        open
        settings={{ autoOpenSinglePage: true }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />,
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Automatically open enlarged page after selecting a card',
    })
    const close = screen.getByRole('button', { name: 'Close' })

    close.focus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(checkbox)

    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
  })

  it('closes when the backdrop itself is pressed', () => {
    const onClose = vi.fn()
    const { container } = render(
      <SettingsModal
        open
        settings={{ autoOpenSinglePage: true }}
        onChange={vi.fn()}
        onClose={onClose}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />,
    )

    const backdrop = container.querySelector('.modal-backdrop')
    expect(backdrop).toBeTruthy()
    fireEvent.mouseDown(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
