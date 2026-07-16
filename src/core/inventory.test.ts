import { describe, expect, it } from 'vitest'
import {
  INVENTORY_BACKUP_KEY,
  INVENTORY_SCHEMA_KEY,
  applyImportedInventories,
  canonicalizeInventory,
  migrateLegacyInventories,
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
})
