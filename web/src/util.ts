import { ApiError } from './api.js';
import { daysUntil, formatDate, t, type MessageKey } from './i18n/index.js';

/** Server error codes → the user's language. */
export function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'unknown';
  const key = `errors.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('errors.withCode', { code }) : text;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dueText(iso?: string): { text: string; tone: '' | 'warn' | 'danger' } {
  if (!iso) return { text: t('bills.due.none'), tone: '' };
  const n = daysUntil(iso);
  if (n < 0) return { text: t('bills.due.overdue', { count: -n }), tone: 'danger' };
  if (n === 0) return { text: t('bills.due.today'), tone: 'danger' };
  if (n === 1) return { text: t('bills.due.tomorrow'), tone: 'warn' };
  if (n <= 5) return { text: t('bills.due.inDays', { count: n }), tone: 'warn' };
  return { text: t('bills.due.on', { date: formatDate(iso) }), tone: '' };
}

export const CATEGORY_EMOJI: Record<string, string> = {
  electricity: '⚡️',
  water: '💧',
  gas: '🔥',
  internet: '📶',
  rent: '🏠',
  phone: '📱',
  insurance: '🛡️',
  other: '🧾',
};
export const CATEGORIES = Object.keys(CATEGORY_EMOJI);
export const categoryLabel = (c: string) => t(`categories.${CATEGORIES.includes(c) ? c : 'other'}` as MessageKey);
export const roleLabel = (r: string) => {
  const key = `roles.${r}` as MessageKey;
  const text = t(key);
  return text === key ? r : text;
};

/** Time-of-day bucket for the greeting. */
export function partOfDay(date = new Date()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
