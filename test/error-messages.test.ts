import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Every error the server can send must read well in the app: each code has
 * a message under `errors.` (the locale files are typed, so if English has
 * it, French, German, Dutch and Vietnamese must too). Field checks such as
 * `amount_invalid` fall back to a general message, so those are covered by
 * the generic `*_invalid` / `*_required` / `*_too_long` messages.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sources = ['server', 'src']
  .flatMap((dir) => walk(join(root, dir)))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function errorKeys(locale: string): Set<string> {
  const text = readFileSync(join(root, 'web', 'src', 'i18n', 'locales', `${locale}.ts`), 'utf8');
  const block = text.slice(text.indexOf('\n  errors: {'), text.indexOf('\n  },', text.indexOf('\n  errors: {')));
  return new Set([...block.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]!));
}

test('every fixed error code the server can send has a readable message', () => {
  const codes = new Set<string>();
  for (const m of sources.matchAll(/(?:bad|AuthError)\('([a-z_]+)'|HttpError\(\d{3}, '([a-z_]+)'\)/g)) codes.add((m[1] ?? m[2])!);
  assert.ok(codes.size > 30, `found ${codes.size} codes`);
  const keys = errorKeys('en');
  const missing = [...codes].filter((c) => !keys.has(c)).sort();
  assert.deepEqual(missing, [], `add these to errors in web/src/i18n/locales/*.ts`);
});

test('general messages exist for field checks', () => {
  for (const locale of ['en', 'vi', 'fr', 'de', 'nl']) {
    const keys = errorKeys(locale);
    for (const k of ['field_invalid', 'field_required', 'field_too_long', 'rate_limited', 'network', 'server_error']) {
      assert.ok(keys.has(k), `${locale}: errors.${k}`);
    }
  }
});
