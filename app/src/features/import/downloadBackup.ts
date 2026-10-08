import { buildExport } from '~/data/applyImport';

const pad = (n: number) => String(n).padStart(2, '0');

/** `SWU-Backup-2026-10-08-143205.json`, in local time; no colons, which some file systems reject. */
export function backupFilename(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `SWU-Backup-${date}-${time}.json`;
}

/** Saves the whole collection — cards, decks, precons — as a timestamped JSON backup. */
export async function downloadBackup(): Promise<void> {
  const payload = await buildExport();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFilename(new Date(payload.exportedAt));
  anchor.click();
  URL.revokeObjectURL(url);
}
