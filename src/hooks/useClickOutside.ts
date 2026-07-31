import React from 'react'

export function useClickOutside<T extends HTMLElement>(active: boolean, onOutsideClick: () => void) {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    if (!active) return
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutsideClick()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [active, onOutsideClick])

  return ref
}
