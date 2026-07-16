import { describe, expect, it } from 'vitest'
import {
  INVENTORY_BACKUP_KEY,
  INVENTORY_SCHEMA_KEY,
  applyImportedInventories,
  canonicalizeInventory,
  collectRawImportEntry,
  loadInventoriesForPersistence,
  migrateLegacyInventories,
  persistCanonicalInventory,
  removePersistedInventory,
  type CanonicalCatalog,
} from './inventory'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value)
  }

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const catalog: CanonicalCatalog = new Map([
  ['SOR:10', { setKey: 'SOR', printingNumber: 10, baseNumber: 10, type: 'Leader' }],
  ['SOR:87', { setKey: 'SOR', printingNumber: 87, baseNumber: 87, type: 'Unit' }],
  ['SOR:351', { setKey: 'SOR', printingNumber: 351, baseNumber: 87, type: 'Unit' }],
  ['SHD:1', { setKey: 'SHD', printingNumber: 1, baseNumber: 1, type: 'Base' }],
])

describe('canonical inventory', () => {
  it('combines printings at the base card and caps after aggregation', () => {
    expect(canonicalizeInventory('SOR', { 87: 2, 351: 2 }, catalog)).toEqual({ 87: 3 })
  })

  it('uses the destination set quota during cross-set merge', () => {
    const result = applyImportedInventories(
      { SHD: { 1: 1 } },
      { SHD: { 1: 2 } },
      'merge',
      catalog,
    )

    expect(result.inventories.SHD).toEqual({ 1: 1 })
  })

  it('canonicalizes retained current sets even when another set is imported', () => {
    const result = applyImportedInventories(
      { SOR: { 351: 2 } },
      { SHD: { 1: 1 } },
      'replace',
      catalog,
    )

    expect(result.inventories.SOR).toEqual({ 87: 2 })
  })

  it('skips unknown and malformed entries', () => {
    expect(canonicalizeInventory('SOR', { 87: 1, 9999: 3, [-1]: 2 }, catalog)).toEqual({
      87: 1,
    })
  })

  it('reports recognized and skipped import entries through the shared normalization path', () => {
    const result = applyImportedInventories(
      {},
      { SOR: { 87: 1, 351: 1, 9999: 4 } },
      'replace',
      catalog,
    )

    expect(result.inventories.SOR).toEqual({ 87: 2 })
    expect(result.recognized).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('rejects reserved and unrecognized imported set keys', () => {
    const result = applyImportedInventories(
      { 'schema-version': { 1: 1 }, SOR: { 87: 1 } },
      {
        'migration:v2:backup': { 87: 1 },
        'schema-version': { 87: 1 },
        ARBITRARY: { 87: 1 },
      },
      'replace',
      catalog,
    )

    expect(result.inventories).toEqual({ SOR: { 87: 1 } })
    expect(result.skipped).toBe(3)
  })

  it('counts malformed raw import entries as skipped', () => {
    const raw: Record<string, Record<number, number>> = {}
    let skipped = 0

    skipped += collectRawImportEntry(raw, 'SOR', 'not-a-number', 2) ? 0 : 1
    skipped += collectRawImportEntry(raw, 'SOR', 87, 'not-a-quantity') ? 0 : 1
    skipped += collectRawImportEntry(raw, 'SOR', 87, 2) ? 0 : 1
    const normalized = applyImportedInventories({}, raw, 'replace', catalog)

    expect(raw).toEqual({ SOR: { 87: 2 } })
    expect(normalized.recognized).toBe(1)
    expect(normalized.skipped + skipped).toBe(2)
  })

  it('backs up and migrates legacy data only once', () => {
    const storage = new MemoryStorage({
      'inv:SOR': JSON.stringify({ 87: 2, 351: 2 }),
    })

    const first = migrateLegacyInventories(storage, ['SOR'], catalog)
    expect(first.SOR).toEqual({ 87: 3 })
    expect(storage.getItem(INVENTORY_BACKUP_KEY)).toContain('351')
    expect(storage.getItem(INVENTORY_SCHEMA_KEY)).toBe('2')

    storage.setItem('inv:SOR', JSON.stringify({ 87: 1 }))
    expect(migrateLegacyInventories(storage, ['SOR'], catalog).SOR).toEqual({ 87: 1 })
  })

  it('writes the backup before normalized inventories and marks the schema last', () => {
    const storage = new MemoryStorage({ 'inv:SOR': JSON.stringify({ 351: 2 }) })
    const writes: string[] = []
    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      writes.push(key)
      originalSetItem(key, value)
    }

    migrateLegacyInventories(storage, ['SOR'], catalog)

    expect(writes).toEqual([INVENTORY_BACKUP_KEY, 'inv:SOR', INVENTORY_SCHEMA_KEY])
  })

  it('does not advance the schema marker when an inventory write fails', () => {
    const storage = new MemoryStorage({ 'inv:SOR': JSON.stringify({ 351: 2 }) })
    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === 'inv:SOR') throw new Error('quota exceeded')
      originalSetItem(key, value)
    }

    expect(() => migrateLegacyInventories(storage, ['SOR'], catalog)).toThrow('quota exceeded')
    expect(storage.getItem(INVENTORY_BACKUP_KEY)).toContain('351')
    expect(storage.getItem(INVENTORY_SCHEMA_KEY)).toBeNull()
  })

  it('does not allow persistence to overwrite legacy data when the backup write fails', () => {
    const legacy = JSON.stringify({ 351: 2 })
    const storage = new MemoryStorage({ 'inv:SOR': legacy })
    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === INVENTORY_BACKUP_KEY) throw new Error('storage unavailable')
      originalSetItem(key, value)
    }

    const loaded = loadInventoriesForPersistence(storage, ['SOR'], catalog)
    if (loaded.persistenceAllowed) {
      storage.setItem('inv:SOR', JSON.stringify(loaded.inventories.SOR))
    }

    expect(loaded.migrationSucceeded).toBe(false)
    expect(loaded.backupPreserved).toBe(false)
    expect(loaded.persistenceAllowed).toBe(false)
    expect(storage.getItem('inv:SOR')).toBe(legacy)
  })

  it('keeps legacy inventory byte-for-byte unchanged when merge and replace imports are persistence-locked', () => {
    const legacy = '{"351":2}'
    const storage = new MemoryStorage({ 'inv:SOR': legacy })
    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === INVENTORY_BACKUP_KEY) throw new Error('storage unavailable')
      originalSetItem(key, value)
    }
    const loaded = loadInventoriesForPersistence(storage, ['SOR'], catalog)

    for (const mode of ['merge', 'replace'] as const) {
      const applied = applyImportedInventories(
        loaded.inventories,
        { SOR: { 87: 1 } },
        mode,
        catalog,
      )
      expect(persistCanonicalInventory(storage, 'SOR', applied.inventories.SOR, catalog)).toBe(false)
      expect(storage.getItem('inv:SOR')).toBe(legacy)
    }
  })

  it('persists successful imports and authorized removals after schema migration', () => {
    const storage = new MemoryStorage({
      'inv:SOR': JSON.stringify({ 87: 1 }),
      [INVENTORY_SCHEMA_KEY]: '2',
    })

    expect(persistCanonicalInventory(storage, 'SOR', { 351: 2 }, catalog)).toBe(true)
    expect(storage.getItem('inv:SOR')).toBe(JSON.stringify({ 87: 2 }))
    expect(removePersistedInventory(storage, 'SOR', catalog)).toBe(true)
    expect(storage.getItem('inv:SOR')).toBeNull()
  })
})
