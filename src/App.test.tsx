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

describe('local inventory safety', () => {
  it('keeps an unsaved quantity in memory and reports an autosave failure', async () => {
    stubSetFetch()
    render(<App />)

    const search = await screen.findByRole('textbox', { name: 'Search cards' })
    fireEvent.change(search, { target: { value: 'Alpha Card' } })
    await waitFor(() => expect(document.querySelector('.sug-item')).toBeTruthy())
    fireEvent.mouseDown(document.querySelector('.sug-item')!)

    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === 'inv:SOR') throw new Error('quota exceeded')
      return originalSetItem.call(this, key, value)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Increase' })[0])

    expect(await screen.findByText('1/3')).toBeTruthy()
    expect(await screen.findByText('Inventory could not be saved on this device.')).toBeTruthy()
    setItem.mockRestore()
  })

  it('shows the set-data failure message for a 404 JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/sets/manifest.json') {
        return response({ sets: [{ key: 'SOR', label: 'SOR', file: 'SWU-SOR.json' }] })
      }
      return response({ error: 'not found' }, false)
    }))

    render(<App />)

    expect(await screen.findByText('Failed to load set data.')).toBeTruthy()
  })
})
