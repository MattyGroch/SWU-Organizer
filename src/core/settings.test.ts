import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, readSettings, SETTINGS_STORAGE_KEY, writeSettings } from './settings'

describe('settings persistence', () => {
  it('enables automatic enlarged-page mode by default', () => {
    expect(DEFAULT_SETTINGS.autoOpenSinglePage).toBe(true)
  })

  it('falls back to defaults for missing or malformed storage', () => {
    expect(readSettings({ getItem: () => null })).toEqual(DEFAULT_SETTINGS)
    expect(readSettings({ getItem: () => '{bad json' })).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips supported settings and ignores unknown values', () => {
    let stored = ''
    const storage = {
      getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? stored : null),
      setItem: (_key: string, value: string) => {
        stored = value
      },
    }

    writeSettings(storage, { autoOpenSinglePage: false })

    expect(readSettings(storage)).toEqual({ autoOpenSinglePage: false })
    stored = JSON.stringify({ autoOpenSinglePage: 'no', futureSetting: true })
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })
})
