export type Card = {
  Name: string
  Subtitle?: string
  Number: number
  Aspects?: string[]
  Type?: string
  Rarity?: string
  MarketPrice?: number
  Set: string
  /** Overrides the default type-based playset quota (3, or 1 for leader/base) for cards whose text allows more/fewer copies, e.g. Swarming Vulture Droid (15). */
  MaxCopies?: number
}

export type Inventory = Record<number, number>
export type SetKey = string
export type SetMeta = { key: string; label: string; file: string }
export type BinderPosition = { number: number; page: number; row: number; column: number }
export type ActiveSelection = BinderPosition & {
  card: Card
  spreadCol: number
  spreadRow: number
}
