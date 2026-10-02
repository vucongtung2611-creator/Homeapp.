import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';

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

export class FileStore {
  private readonly dir: string;

  constructor(
    private readonly db: Db,
    dataDir: string,
  ) {
    this.dir = join(dataDir, 'files');
    mkdirSync(this.dir, { recursive: true });
  }

  save(input: { householdId: string; uploaderId: string; bytes: Uint8Array; name?: string }): StoredFile | { error: string } {
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
    // The on-disk name is the random id only — never user input.
    writeFileSync(join(this.dir, file.id), input.bytes);
    this.db
      .prepare('INSERT INTO files (id, household_id, uploader_id, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(file.id, file.household_id, file.uploader_id, file.mime, file.size, file.name, file.created_at);
    return file;
  }

  get(id: string): StoredFile | undefined {
    if (!/^f_[0-9a-f-]{36}$/.test(id)) return undefined;
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as StoredFile | undefined;
  }

  read(file: StoredFile): Buffer {
    return readFileSync(join(this.dir, file.id));
  }

  remove(id: string): void {
    const file = this.get(id);
    if (!file) return;
    this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
    try {
      unlinkSync(join(this.dir, file.id));
    } catch {
      // already gone
    }
  }
}
