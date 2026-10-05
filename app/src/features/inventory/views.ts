/** The per-set pages of the Inventory tab. The bulk box has its own, across every set. */
export const INVENTORY_VIEWS = ['binder', 'list'] as const;

export type InventoryView = (typeof INVENTORY_VIEWS)[number];

export function isInventoryView(value: string): value is InventoryView {
  return (INVENTORY_VIEWS as readonly string[]).includes(value);
}
