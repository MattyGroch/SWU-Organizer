import type { BinderPosition } from './types'

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

export function binderLayout(number: number): Omit<BinderPosition, 'number'> {
  const page = Math.floor((number - 1) / 12) + 1
  const row = Math.floor(((number - 1) % 12) / 4) + 1
  const column = ((number - 1) % 4) + 1
  return { page, row, column }
}

export function getSpreadCoords(page: number, row: number, column: number) {
  const isOddPage = page % 2 !== 0
  return {
    spreadCol: isOddPage ? column + 4 : column,
    spreadRow: row,
  }
}

export function numberFromPagePosition(
  page: number,
  row: number,
  column: number,
): number {
  return (page - 1) * 12 + (row - 1) * 4 + column
}

export function pageToSpread(page: number): number {
  return page <= 1 ? 0 : Math.floor((page - 2) / 2) + 1
}

export function spreadToPrimaryPage(spread: number): number {
  return spread <= 0 ? 1 : 2 + (spread - 1) * 2
}

export function moveBinderSelection(
  selection: BinderPosition,
  direction: MoveDirection,
  totalPages: number,
): BinderPosition {
  const { spreadCol, spreadRow } = getSpreadCoords(
    selection.page,
    selection.row,
    selection.column,
  )
  let nextSpreadCol = spreadCol
  let nextSpreadRow = spreadRow
  let targetSpread = pageToSpread(selection.page)

  if (direction === 'left') nextSpreadCol -= 1
  if (direction === 'right') nextSpreadCol += 1
  if (direction === 'up') nextSpreadRow -= 1
  if (direction === 'down') nextSpreadRow += 1

  if (nextSpreadCol > 8) {
    nextSpreadCol = 1
    targetSpread += 1
  } else if (nextSpreadCol < 1) {
    nextSpreadCol = 8
    targetSpread -= 1
  }

  if (nextSpreadRow > 3) {
    nextSpreadRow = 1
    targetSpread += 1
  } else if (nextSpreadRow < 1) {
    nextSpreadRow = 3
    targetSpread -= 1
  }

  const finalSpread = pageToSpread(totalPages)
  if (targetSpread < 0 || targetSpread > finalSpread) return selection

  let targetPage = spreadToPrimaryPage(targetSpread)
  let targetColumn: number

  if (nextSpreadCol <= 4) {
    targetColumn = nextSpreadCol
    if (targetPage % 2 !== 0 && targetPage > 1) targetPage -= 1
    if (targetPage === 1) return selection
  } else {
    targetColumn = nextSpreadCol - 4
    if (targetPage % 2 === 0) targetPage += 1
  }

  const number = numberFromPagePosition(targetPage, nextSpreadRow, targetColumn)
  if (number > totalPages * 12) return selection

  return {
    number,
    page: targetPage,
    row: nextSpreadRow,
    column: targetColumn,
  }
}
