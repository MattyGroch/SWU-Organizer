import { describe, expect, it } from 'vitest'
import {
  binderLayout,
  getSpreadCoords,
  moveBinderSelection,
  pageToSpread,
} from './binder'

describe('binder geometry', () => {
  it.each([
    [1, { page: 1, row: 1, column: 1 }],
    [4, { page: 1, row: 1, column: 4 }],
    [5, { page: 1, row: 2, column: 1 }],
    [12, { page: 1, row: 3, column: 4 }],
    [13, { page: 2, row: 1, column: 1 }],
  ])('maps card %i to its physical position', (number, expected) => {
    expect(binderLayout(number)).toEqual(expected)
  })

  it('keeps physical and spread columns distinct', () => {
    expect(getSpreadCoords(1, 1, 1)).toEqual({ spreadCol: 5, spreadRow: 1 })
    expect(binderLayout(1).column).toBe(1)
  })

  it('moves right from the final column to the adjacent physical page', () => {
    const selection = { ...binderLayout(16), number: 16 }
    expect(moveBinderSelection(selection, 'right', 10)).toMatchObject({
      number: 25,
      page: 3,
      row: 1,
      column: 1,
    })
  })

  it('preserves vertical spread wrapping', () => {
    const selection = { ...binderLayout(24), number: 24 }
    expect(moveBinderSelection(selection, 'down', 10)).toMatchObject({
      page: 4,
      row: 1,
      column: 4,
    })
  })

  it('does not move beyond the first or last spread', () => {
    const first = { ...binderLayout(1), number: 1 }
    expect(moveBinderSelection(first, 'left', 1)).toEqual(first)
    expect(pageToSpread(1)).toBe(0)
  })
})
