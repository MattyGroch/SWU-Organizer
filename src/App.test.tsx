import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const sorCards = [
  { Name: 'Alpha Card', Subtitle: 'First Choice', Number: 1, Type: 'Unit' },
  { Name: 'Beta Card', Subtitle: 'Second Choice', Number: 2, Type: 'Unit' },
  {
    Name: 'Darth Vader',
    Subtitle: 'Dark Lord of the Sith',
    Number: 10,
    Type: 'Leader',
  },
  {
    Name: 'Darth Vader',
    Subtitle: 'Commanding the First Legion',
    Number: 87,
    Type: 'Unit',
  },
]

const twiCards = [{ Name: 'Brain Invaders', Number: 255, Type: 'Unit' }]

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function stubSetFetch(includeTwi = false) {
  const sets = [
    { key: 'SOR', label: 'Spark of Rebellion (SOR)', file: 'SWU-SOR.json' },
    ...(includeTwi
      ? [{ key: 'TWI', label: 'Twilight of the Republic (TWI)', file: 'SWU-TWI.json' }]
      : []),
  ]

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/sets/manifest.json') return response({ sets })
    if (url === '/sets/SWU-SOR.json') return response(sorCards)
    if (url === '/sets/SWU-TWI.json') return response(twiCards)
    return response({}, false)
  }))
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('search submission', () => {
  it('uses the current highlighted result after search loses focus', async () => {
    stubSetFetch()
    render(<App />)

    const search = await screen.findByRole('textbox', { name: 'Search cards' })
    fireEvent.change(search, { target: { value: 'Card' } })
    await waitFor(() => expect(document.querySelectorAll('.sug-item')).toHaveLength(2))

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.blur(search)
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.queryByText('No card selected')).toBeNull()
      expect(screen.getByText((_, element) => element?.textContent === '— Second Choice')).toBeTruthy()
    })
  })

  it('resolves a cross-set suggestion after the destination catalog becomes active', async () => {
    stubSetFetch(true)
    render(<App />)

    const search = await screen.findByRole('textbox', { name: 'Search cards' })
    fireEvent.change(search, { target: { value: 'Darth Vader' } })
    const subtitle = await screen.findByText(/Dark Lord of the Sith/)
    fireEvent.mouseDown(subtitle)

    await waitFor(() => {
      const setPicker = within(screen.getByRole('group', { name: 'Card set' })).getByRole('combobox')
      expect((setPicker as HTMLSelectElement).value).toBe('SOR')
      expect(screen.getByText((_, element) => element?.textContent === '— Dark Lord of the Sith')).toBeTruthy()
    })
  })
})

describe('settings', () => {
  it('falls back to defaults when initial local storage access is unavailable', () => {
    stubSetFetch()
    const availableStorage = window.localStorage
    availableStorage.setItem('swu:settings:v1', JSON.stringify({ autoOpenSinglePage: false }))
    let storageReads = 0
    const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      storageReads += 1
      if (storageReads === 1) throw new Error('storage access denied')
      return availableStorage
    })

    try {
      expect(() => render(<App />)).not.toThrow()
      expect(storageReads).toBeGreaterThan(0)
      fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
      expect(
        (screen.getByRole('checkbox', {
          name: 'Automatically open enlarged page after selecting a card',
        }) as HTMLInputElement).checked,
      ).toBe(true)
    } finally {
      storageGetter.mockRestore()
    }
  })

  it('persists changes immediately and keeps them in component state', async () => {
    stubSetFetch()
    render(<App />)

    const trigger = await screen.findByRole('button', { name: 'Open settings' })
    fireEvent.click(trigger)
    const checkbox = screen.getByRole('checkbox', {
      name: 'Automatically open enlarged page after selecting a card',
    })
    expect((checkbox as HTMLInputElement).checked).toBe(true)

    fireEvent.click(checkbox)

    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(JSON.parse(localStorage.getItem('swu:settings:v1') ?? '{}')).toEqual({
      autoOpenSinglePage: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(trigger)
    expect(
      (screen.getByRole('checkbox', {
        name: 'Automatically open enlarged page after selecting a card',
      }) as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('keeps a changed setting and shows a toast when persistence fails', async () => {
    stubSetFetch()
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }))
    const checkbox = screen.getByRole('checkbox', {
      name: 'Automatically open enlarged page after selecting a card',
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    fireEvent.click(checkbox)

    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(await screen.findByText('Settings could not be saved on this device.')).toBeTruthy()
    setItem.mockRestore()
  })
})
