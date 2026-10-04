/**
 * Minimal RFC 4180 CSV reader.
 *
 * The legacy parser used a regex per line — `line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)` —
 * which drops empty fields, mangles quoted fields containing commas, and cannot handle a
 * newline inside a quoted value. Card subtitles routinely contain commas, so this is a
 * character-wise reader instead.
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(text: string): CsvTable {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  // Strip a UTF-8 BOM; Excel writes one and it would corrupt the first header.
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the record.
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headerRow, ...rest] = nonEmpty;
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map((h) => h.trim());
  // Pad short rows so trailing empty columns are addressable by index.
  const rows = rest.map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push('');
    return padded;
  });

  return { headers, rows };
}
