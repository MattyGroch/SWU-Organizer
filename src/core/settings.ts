export type AppSettings = {
  autoOpenSinglePage: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoOpenSinglePage: true,
}

export const SETTINGS_STORAGE_KEY = 'swu:settings:v1'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

export function readSettings(storage: ReadStorage): AppSettings {
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<AppSettings>
    return {
      autoOpenSinglePage:
        typeof parsed.autoOpenSinglePage === 'boolean'
          ? parsed.autoOpenSinglePage
          : DEFAULT_SETTINGS.autoOpenSinglePage,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(storage: WriteStorage, settings: AppSettings): void {
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}
