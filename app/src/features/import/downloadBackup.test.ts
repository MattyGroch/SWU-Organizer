import { describe, expect, it } from 'vitest';
import { backupFilename } from './downloadBackup';

describe('backupFilename', () => {
  it('carries the local date and time, zero-padded', () => {
    expect(backupFilename(new Date(2026, 0, 5, 9, 3, 7))).toBe('SWU-Backup-2026-01-05-090307.json');
  });

  it('uses local time, so an evening export keeps its own date', () => {
    expect(backupFilename(new Date(2026, 9, 8, 23, 59, 59))).toBe(
      'SWU-Backup-2026-10-08-235959.json',
    );
  });
});
