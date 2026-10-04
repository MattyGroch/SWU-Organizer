import {
  importSheet,
  importText,
  UnrecognizedImportError,
  type CatalogLookup,
  type ImportResult,
} from '~/domain/import';

/**
 * Reads an import file.
 *
 * SheetJS is loaded only when a spreadsheet is actually dropped. The legacy app imported
 * it at the top of App.tsx, putting a ~400 KB parser in the main bundle for a feature
 * used a few times a year.
 */
export async function readImportFile(file: File, catalog: CatalogLookup): Promise<ImportResult> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'xlsx' || extension === 'xls') {
    return readSpreadsheet(file, catalog);
  }

  return importText(await file.text(), catalog);
}

async function readSpreadsheet(file: File, catalog: CatalogLookup): Promise<ImportResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new UnrecognizedImportError();

  // `header: 1` yields raw rows, so the variant columns stay positional and are read the
  // same way as the CSV path rather than through a second, divergent code path.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const [headerRow, ...dataRows] = grid;
  if (!headerRow) throw new UnrecognizedImportError();

  const headers = headerRow.map((cell) => String(cell ?? '').trim());
  const rows = dataRows.map((row) => {
    const cells = row.map((cell) => String(cell ?? '').trim());
    while (cells.length < headers.length) cells.push('');
    return cells;
  });

  return importSheet(headers, rows, catalog);
}
