export class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 429,
    readonly code: string,
  ) {
    super(code);
  }
}

export const bad = (code: string) => new HttpError(400, code);

export function str(v: unknown, opts: { max: number; required?: boolean; field: string }): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw bad(`${opts.field}_required`);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`${opts.field}_invalid`);
  const s = v.trim();
  if (opts.required && !s) throw bad(`${opts.field}_required`);
  if (s.length > opts.max) throw bad(`${opts.field}_too_long`);
  return s || undefined;
}

export function amount(v: unknown, field = 'amount'): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e12) throw bad(`${field}_invalid`);
  return n;
}

export function isoDate(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${field}_invalid`);
  return v;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad(`${field}_invalid`);
  return v as T;
}

export function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw bad('boolean_invalid');
  return v;
}

export function ids(v: unknown, field: string, max = 20): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length > 100)) throw bad(`${field}_invalid`);
  return [...new Set(v as string[])];
}

export function tags(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 30 || v.some((x) => typeof x !== 'string' || x.length > 40)) throw bad('tags_invalid');
  return v as string[];
}

export const CURRENCIES = ['VND', 'AUD', 'USD', 'EUR', 'GBP', 'NZD', 'SGD', 'CAD', 'JPY', 'KRW'] as const;
export const BILL_CATEGORIES = ['electricity', 'water', 'gas', 'internet', 'rent', 'phone', 'insurance', 'other'] as const;
