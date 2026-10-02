import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './database.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface StoredFile {
  id: string;
  household_id: string;
  uploader_id: string;
  mime: string;
  size: number;
  name: string;
  created_at: string;
}

/**
 * Identify a file by its first bytes. The client's Content-Type is ignored:
 * only these formats are accepted, and the type we serve back is the sniffed
 * one (so an "image" can never be served as HTML or SVG).
 */
export function sniffMime(bytes: Uint8Array): string | undefined {
  const b = (i: number) => bytes[i];
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return undefined;
}

export function safeFileName(raw: string | undefined, mime: string): string {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime];
  let name = decodeURIComponentSafe(raw ?? '')
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, '')
    .trim()
    .slice(0, 120);
  if (!name) name = `file.${ext}`;
  return name;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * File bytes are stored in the database (BLOB / BYTEA) so the app runs on
 * hosts whose disk is wiped on restart. Files written to disk by older
 * versions are still read from `<dataDir>/files/<id>`.
 */
export class FileStore {
  private readonly legacyDir?: string;

  constructor(
    private readonly db: Database,
    dataDir?: string,
  ) {
    this.legacyDir = dataDir ? join(dataDir, 'files') : undefined;
  }

  async save(input: { householdId: string; uploaderId: string; bytes: Uint8Array; name?: string }): Promise<StoredFile | { error: string }> {
    if (input.bytes.byteLength === 0) return { error: 'empty_file' };
    if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return { error: 'file_too_large' };
    const mime = sniffMime(input.bytes);
    if (!mime) return { error: 'unsupported_file_type' };
    const file: StoredFile = {
      id: `f_${randomUUID()}`,
      household_id: input.householdId,
      uploader_id: input.uploaderId,
      mime,
      size: input.bytes.byteLength,
      name: safeFileName(input.name, mime),
      created_at: new Date().toISOString(),
    };
    await this.db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO files (id, household_id, uploader_id, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        file.id,
        file.household_id,
        file.uploader_id,
        file.mime,
        file.size,
        file.name,
        file.created_at,
      );
      await tx.run('INSERT INTO file_data (id, data) VALUES (?, ?)', file.id, input.bytes);
    });
    return file;
  }

  async get(id: string): Promise<StoredFile | undefined> {
    if (!/^f_[0-9a-f-]{36}$/.test(id)) return undefined;
    const row = await this.db.get<StoredFile>('SELECT * FROM files WHERE id = ?', id);
    return row && { ...row, size: Number(row.size) };
  }

  async read(file: StoredFile): Promise<Uint8Array> {
    const row = await this.db.get<{ data: Uint8Array }>('SELECT data FROM file_data WHERE id = ?', file.id);
    if (row) return new Uint8Array(row.data);
    if (this.legacyDir) return new Uint8Array(readFileSync(join(this.legacyDir, file.id)));
    throw new Error('file_data_missing');
  }

  /** Bytes used by a household. */
  async usage(householdId: string): Promise<number> {
    const row = await this.db.get<{ s: number | string | null }>('SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE household_id = ?', householdId);
    return Number(row?.s ?? 0);
  }

  async remove(id: string): Promise<void> {
    const file = await this.get(id);
    if (!file) return;
    await this.db.run('DELETE FROM file_data WHERE id = ?', id);
    await this.db.run('DELETE FROM files WHERE id = ?', id);
    if (this.legacyDir) {
      try {
        unlinkSync(join(this.legacyDir, file.id));
      } catch {
        // not on disk
      }
    }
  }
}
