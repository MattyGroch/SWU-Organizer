export type Card = {
  Name: string
  Subtitle?: string
  Number: number
  Aspects?: string[]
  Type?: string
  Rarity?: string
  MarketPrice?: number
  Set: string
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
