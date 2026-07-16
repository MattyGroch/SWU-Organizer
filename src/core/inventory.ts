import type { Inventory, SetKey } from './types'

export type CanonicalCardRef = {
  setKey: SetKey
  printingNumber: number
  baseNumber: number
  type?: string
}

export type CanonicalCatalog = Map<string, CanonicalCardRef>
export type ImportMode = 'merge' | 'replace'
export type ImportResult = {
  inventories: Record<SetKey, Inventory>
  recognized: number
  skipped: number
}

export type InventoryLoadResult = {
  inventories: Record<SetKey, Inventory>
  migrationSucceeded: boolean
  backupPreserved: boolean
  persistenceAllowed: boolean
}

export const INVENTORY_SCHEMA_VERSION = '2'
export const INVENTORY_SCHEMA_KEY = 'inv:schema-version'
export const INVENTORY_BACKUP_KEY = 'inv:migration:v2:backup'

export function quotaForType(type?: string): number {
  const normalized = (type ?? '').trim().toLowerCase()
  return normalized === 'leader' || normalized === 'base' ? 1 : 3
}

function asInventory(value: unknown): Inventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Inventory
}

function parseInventory(raw: string | null): Inventory {
  if (!raw) return {}
  try {
    return asInventory(JSON.parse(raw))
  } catch {
    return {}
  }
}

function canonicalRef(
  catalog: CanonicalCatalog,
  setKey: SetKey,
  printingNumber: number,
): CanonicalCardRef | undefined {
  const printing = catalog.get(`${setKey}:${printingNumber}`)
  if (!printing || printing.setKey !== setKey) return undefined
  return catalog.get(`${setKey}:${printing.baseNumber}`) ?? printing
}

function knownSetKeys(catalog: CanonicalCatalog): Set<SetKey> {
  return new Set([...catalog.values()].map(ref => ref.setKey))
}

export function collectRawImportEntry(
  imported: Record<SetKey, Inventory>,
  rawSetKey: unknown,
  rawPrintingNumber: unknown,
  rawQuantity: unknown,
): boolean {
  const setKey = typeof rawSetKey === 'string' ? rawSetKey.trim().toUpperCase() : ''
  const printingNumber = Number(rawPrintingNumber)
  const quantity = Number(rawQuantity)
  if (
    !setKey ||
    !Number.isInteger(printingNumber) ||
    printingNumber <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return false
  }

  const inventory = imported[setKey] ?? (imported[setKey] = {})
  inventory[printingNumber] = (inventory[printingNumber] ?? 0) + quantity
  return true
}

function normalizedEntries(
  setKey: SetKey,
  inventory: Inventory,
  catalog: CanonicalCatalog,
): Array<{ ref: CanonicalCardRef; quantity: number }> {
  const result: Array<{ ref: CanonicalCardRef; quantity: number }> = []

  for (const [rawNumber, rawQuantity] of Object.entries(inventory)) {
    const printingNumber = Number(rawNumber)
    const quantity = Number(rawQuantity)
    if (
      !Number.isInteger(printingNumber) ||
      printingNumber <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue
    }

    const ref = canonicalRef(catalog, setKey, printingNumber)
    if (ref) result.push({ ref, quantity })
  }

  return result
}

export function canonicalizeInventory(
  setKey: SetKey,
  inventory: Inventory,
  catalog: CanonicalCatalog,
): Inventory {
  const canonical: Inventory = {}

  for (const { ref, quantity } of normalizedEntries(setKey, inventory, catalog)) {
    canonical[ref.baseNumber] = Math.min(
      (canonical[ref.baseNumber] ?? 0) + quantity,
      quotaForType(ref.type),
    )
  }

  return canonical
}

export function applyImportedInventories(
  current: Record<SetKey, Inventory>,
  imported: Record<SetKey, Inventory>,
  mode: ImportMode,
  catalog: CanonicalCatalog,
): ImportResult {
  const allowedSets = knownSetKeys(catalog)
  const inventories = Object.fromEntries(
    Object.entries(current)
      .filter(([setKey]) => allowedSets.has(setKey))
      .map(([setKey, inventory]) => [
        setKey,
        canonicalizeInventory(setKey, inventory, catalog),
      ]),
  ) as Record<SetKey, Inventory>
  let recognized = 0
  let skipped = 0

  for (const [setKey, rawImported] of Object.entries(imported)) {
    if (!allowedSets.has(setKey)) {
      skipped += Object.keys(asInventory(rawImported)).length
      continue
    }
    const currentCanonical = canonicalizeInventory(setKey, current[setKey] ?? {}, catalog)
    const destination: Inventory = mode === 'merge' ? { ...currentCanonical } : {}

    for (const [rawNumber, rawQuantity] of Object.entries(asInventory(rawImported))) {
      const printingNumber = Number(rawNumber)
      const quantity = Number(rawQuantity)
      const validNumber = Number.isInteger(printingNumber) && printingNumber > 0
      const validQuantity = Number.isFinite(quantity) && quantity > 0
      const ref = validNumber ? canonicalRef(catalog, setKey, printingNumber) : undefined

      if (!validNumber || !validQuantity || !ref) {
        skipped += 1
        continue
      }

      recognized += 1
      destination[ref.baseNumber] = Math.min(
        (destination[ref.baseNumber] ?? 0) + quantity,
        quotaForType(ref.type),
      )
    }

    inventories[setKey] = destination
  }

  return { inventories, recognized, skipped }
}

export function migrateLegacyInventories(
  storage: Storage,
  setKeys: SetKey[],
  catalog: CanonicalCatalog,
): Record<SetKey, Inventory> {
  const rawInventories = Object.fromEntries(
    setKeys.map(setKey => [setKey, storage.getItem(`inv:${setKey}`)]),
  ) as Record<SetKey, string | null>

  const canonical = Object.fromEntries(
    setKeys.map(setKey => [
      setKey,
      canonicalizeInventory(setKey, parseInventory(rawInventories[setKey]), catalog),
    ]),
  ) as Record<SetKey, Inventory>

  if (storage.getItem(INVENTORY_SCHEMA_KEY) === INVENTORY_SCHEMA_VERSION) return canonical

  if (storage.getItem(INVENTORY_BACKUP_KEY) === null) {
    storage.setItem(INVENTORY_BACKUP_KEY, JSON.stringify(rawInventories))
  }

  for (const setKey of setKeys) {
    storage.setItem(`inv:${setKey}`, JSON.stringify(canonical[setKey]))
  }

  storage.setItem(INVENTORY_SCHEMA_KEY, INVENTORY_SCHEMA_VERSION)
  return canonical
}

export function loadInventoriesForPersistence(
  storage: Storage,
  setKeys: SetKey[],
  catalog: CanonicalCatalog,
): InventoryLoadResult {
  try {
    const inventories = migrateLegacyInventories(storage, setKeys, catalog)
    let backupPreserved = false
    try {
      backupPreserved = storage.getItem(INVENTORY_BACKUP_KEY) !== null
    } catch {
      // Migration success is sufficient to permit canonical persistence.
    }
    return { inventories, migrationSucceeded: true, backupPreserved, persistenceAllowed: true }
  } catch {
    const inventories = Object.fromEntries(setKeys.map(setKey => {
      let inventory: Inventory = {}
      try {
        inventory = parseInventory(storage.getItem(`inv:${setKey}`))
      } catch {
        // Recover other valid set records even if one storage read fails.
      }
      return [setKey, canonicalizeInventory(setKey, inventory, catalog)]
    })) as Record<SetKey, Inventory>

    let backupPreserved = false
    try {
      backupPreserved = storage.getItem(INVENTORY_BACKUP_KEY) !== null
    } catch {
      // If preservation cannot be demonstrated, persistence must stay disabled.
    }

    return {
      inventories,
      migrationSucceeded: false,
      backupPreserved,
      persistenceAllowed: backupPreserved,
    }
  }
}

export function inventoryPersistenceAuthorized(storage: Storage): boolean {
  try {
    return (
      storage.getItem(INVENTORY_SCHEMA_KEY) === INVENTORY_SCHEMA_VERSION ||
      storage.getItem(INVENTORY_BACKUP_KEY) !== null
    )
  } catch {
    return false
  }
}

export function persistCanonicalInventory(
  storage: Storage,
  setKey: SetKey,
  inventory: Inventory,
  catalog: CanonicalCatalog,
): boolean {
  if (!inventoryPersistenceAuthorized(storage) || !knownSetKeys(catalog).has(setKey)) return false
  try {
    storage.setItem(`inv:${setKey}`, JSON.stringify(canonicalizeInventory(setKey, inventory, catalog)))
    return true
  } catch {
    return false
  }
}

export function removePersistedInventory(
  storage: Storage,
  setKey: SetKey,
  catalog: CanonicalCatalog,
): boolean {
  if (!inventoryPersistenceAuthorized(storage) || !knownSetKeys(catalog).has(setKey)) return false
  try {
    storage.removeItem(`inv:${setKey}`)
    return true
  } catch {
    return false
  }
}
