import { pageToSpread, spreadToPrimaryPage } from './binder';

export function focusedPageForSpread(
  currentPage: number,
  requestedSpread: number,
  totalPages: number,
): number {
  const lastPage = Math.max(1, totalPages);
  const lastSpread = pageToSpread(lastPage);
  const targetSpread = Math.max(0, Math.min(lastSpread, requestedSpread));
  if (targetSpread === 0) return 1;

  const leftPage = spreadToPrimaryPage(targetSpread);
  const rightPage = leftPage + 1;
  const preserveRightSide = currentPage === 1 || currentPage % 2 === 1;
  return Math.min(lastPage, preserveRightSide ? rightPage : leftPage);
}
