/** Shared display formatting. Kept out of component files so fast refresh stays intact. */

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

/** Page 1 stands alone; every later spread shows a facing pair, like the real binder. */
export function spreadLabel(spread: number): string {
  if (spread <= 0) return 'Page 1';
  const left = 2 + (spread - 1) * 2;
  return `Pages ${left}/${left + 1}`;
}
