/**
 * Tiny i18n runtime. Every UI string lives in ./locales/<code>.ts; English is
 * the source of truth and the fallback for anything a locale hasn't
 * translated yet.
 *
 * Message values:
 *   'Hello {name}'                        → interpolation
 *   { one: '# bill', other: '# bills' }   → plural (Intl.PluralRules), # = count
 *   ['Hi!', 'Hey there!']                 → variants (one picked at random)
 */
import { LOCALES, type LocaleCode } from './locales/index.js';
import type en from './locales/en.js';

type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type Leaf = string | Plural | readonly string[];
type Tree = { readonly [k: string]: Leaf | Tree };

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type PluralKey = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type IsPlural<T> = T extends { other: string } ? (Exclude<keyof T, PluralKey> extends never ? true : false) : false;
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string | readonly string[] ? K : IsPlural<T[K]> extends true ? K : Join<K, Leaves<T[K]>>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type Params = Record<string, string | number | undefined>;

const STORAGE_KEY = 'homeapp:locale';
const english = LOCALES.find((l) => l.code === 'en')!.messages as Tree;

/** Share of English keys a locale translates (0..1). */
function coverage(messages: Tree): number {
  let total = 0;
  let done = 0;
  const walk = (ref: Tree, other: Tree | undefined) => {
    for (const [k, v] of Object.entries(ref)) {
      if (isLeaf(v)) {
        total++;
        if (other && other[k] !== undefined) done++;
      } else walk(v as Tree, other?.[k] as Tree | undefined);
    }
  };
  walk(english, messages);
  return total ? done / total : 0;
}

const PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];
/** A plural is an object with `other` whose keys are all plural categories. */
const isLeaf = (v: unknown): v is Leaf =>
  typeof v === 'string' ||
  Array.isArray(v) ||
  (typeof v === 'object' && v !== null && 'other' in v && Object.keys(v).every((k) => PLURAL_KEYS.includes(k)));

/** Locales offered in the picker: a locale appears once its file is ~complete. */
export const AVAILABLE = LOCALES.filter((l) => coverage(l.messages as Tree) >= 0.9);

function detect(): LocaleCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && AVAILABLE.some((l) => l.code === saved)) return saved as LocaleCode;
  } catch {}
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    const match = AVAILABLE.find((l) => l.code === base);
    if (match) return match.code;
  }
  return 'en';
}

let current: LocaleCode = detect();
let messages = LOCALES.find((l) => l.code === current)!.messages as Tree;
const listeners = new Set<() => void>();
document.documentElement.lang = current;

export const getLocale = () => current;

export function setLocale(code: LocaleCode): void {
  const entry = AVAILABLE.find((l) => l.code === code);
  if (!entry || code === current) return;
  current = code;
  messages = entry.messages as Tree;
  document.documentElement.lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {}
  listeners.forEach((fn) => fn());
}

/** Has this person picked a language on this device (as opposed to us guessing from the browser)? */
export function hasChosenLocale(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true; // no storage (private mode): never trap anyone behind the picker
  }
}

/** Pick a language and remember that the person chose it, even if it equals the guess. */
export function chooseLocale(code: LocaleCode): void {
  setLocale(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {}
  listeners.forEach((fn) => fn());
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(tree: Tree, key: string): Leaf | undefined {
  let node: Leaf | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || isLeaf(node)) return undefined;
    node = (node as Tree)[part];
  }
  return node !== undefined && isLeaf(node) ? node : undefined;
}

const plurals = new Map<string, Intl.PluralRules>();
function pluralCategory(n: number): Intl.LDMLPluralRule {
  let rules = plurals.get(current);
  if (!rules) plurals.set(current, (rules = new Intl.PluralRules(current)));
  return rules.select(n);
}

/** Translate a key. Missing in this locale → English → the key itself. */
export function t(key: MessageKey, params: Params = {}): string {
  const value = lookup(messages, key) ?? lookup(english, key);
  if (value === undefined) return key;
  let text: string;
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value[Math.floor(Math.random() * value.length)] ?? '';
  else {
    const n = Number(params.count ?? 0);
    const p = value as Plural;
    text = (n === 0 && p.zero) || p[pluralCategory(n)] || p.other;
    text = text.replace(/#/g, formatNumber(n));
  }
  return text.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] === undefined ? `{${name}}` : String(params[name])));
}

/** Like t() but always the same variant for the same seed (stable greetings). */
export function tPick(key: MessageKey, seed: number, params: Params = {}): string {
  const value = lookup(messages, key) ?? lookup(english, key);
  if (!Array.isArray(value)) return t(key, params);
  const text = value[Math.abs(seed) % value.length] ?? '';
  return text.replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name] ?? ''));
}

// ── Locale-aware formatting ──────────────────────────────────────────
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, options).format(n);
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(current, { style: 'currency', currency }).format(amount);
  } catch {
    return `${formatNumber(amount)} ${currency}`;
  }
}

export function currencyDigitsOf(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** An amount the way people type it in this locale (1.234.567 / 1,234,567.5). */
export function formatAmountInput(amount: number | undefined, currency: string): string {
  if (amount === undefined) return '';
  return formatNumber(amount, { maximumFractionDigits: currencyDigitsOf(currency) });
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames([current], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const parseIso = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/** yyyy-mm-dd → local short date (10/15/2026, 15/10/2026, 15.10.2026…) */
export function formatDate(iso?: string, style: 'short' | 'medium' = 'short'): string {
  if (!iso) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseIso(iso) : new Date(iso);
  return new Intl.DateTimeFormat(current, style === 'short' ? { dateStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(current, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatList(items: string[]): string {
  try {
    return new Intl.ListFormat(current, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return t('chat.today');
  if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
  return new Intl.DateTimeFormat(current, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export function daysUntil(iso: string): number {
  const target = parseIso(iso).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}
