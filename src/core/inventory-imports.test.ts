import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCsvData, parseXlsxData } from '../App'
import type { CanonicalCatalog } from './inventory'

const catalog: CanonicalCatalog = new Map([
  ['SOR:87', { setKey: 'SOR', printingNumber: 87, baseNumber: 87, type: 'Unit' }],
  ['SOR:351', { setKey: 'SOR', printingNumber: 351, baseNumber: 87, type: 'Unit' }],
])

describe('inventory import parser statistics', () => {
  it('counts malformed and reserved CSV entries as skipped', () => {
    const parsed = parseCsvData(
      'inventory.csv',
      [
        'Set,CardNumber,Count',
        'SOR,87,1',
        'SOR,not-a-number,2',
        'SOR,351,not-a-quantity',
        'schema-version,87,1',
      ].join('\n'),
      catalog,
    )

    expect(parsed.inventories).toEqual({ SOR: { 87: 1 } })
    expect(parsed.recognized).toBe(1)
    expect(parsed.skipped).toBe(3)
  })

  it('counts malformed and reserved JSON entries as skipped', () => {
    const parsed = parseCsvData(
      'inventory.json',
      JSON.stringify({
        version: 1,
        sets: {
          SOR: { 87: 1, invalid: 2, 351: 'not-a-quantity' },
          'migration:v2:backup': { 87: 1 },
        },
      }),
      catalog,
    )

    expect(parsed.inventories).toEqual({ SOR: { 87: 1 } })
    expect(parsed.recognized).toBe(1)
    expect(parsed.skipped).toBe(3)
  })

  it('counts malformed and reserved XLSX rows as skipped', async () => {
    const sheet = XLSX.utils.json_to_sheet([
      { Set: 'SOR', 'Base card id': 87, Normal: 1 },
      { Set: 'SOR', 'Base card id': 'invalid', Normal: 2 },
      { Set: 'schema-version', 'Base card id': 87, Normal: 1 },
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Inventory')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
    const file = new File([bytes], 'inventory.xlsx')

    const parsed = await parseXlsxData(file, catalog)

    expect(parsed.inventories).toEqual({ SOR: { 87: 1 } })
    expect(parsed.recognized).toBe(1)
    expect(parsed.skipped).toBe(2)
  })
})
