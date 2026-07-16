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
  const inventories = Object.fromEntries(
    Object.entries(current).map(([setKey, inventory]) => [
      setKey,
      canonicalizeInventory(setKey, inventory, catalog),
    ]),
  ) as Record<SetKey, Inventory>
  let recognized = 0
  let skipped = 0

  for (const [setKey, rawImported] of Object.entries(imported)) {
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
