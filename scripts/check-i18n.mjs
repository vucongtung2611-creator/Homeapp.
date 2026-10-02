// Fails when UI text is hard-coded in web/src instead of the translation files.
// Checks JSX text nodes and user-facing attributes for letters. Escape hatch:
// put `i18n-ignore` in a comment on the same line.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../web/src/', import.meta.url).pathname;
const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!p.includes('/i18n/locales')) walk(p);
    } else if (p.endsWith('.tsx')) files.push(p);
  }
};
walk(root);

// Text right after an opening/closing tag, up to the next tag, brace or end of line.
const jsxText = /<\/?[A-Za-z][^<>]*>\s*([^<>{}()=;\s][^<>{}()=;]*\p{L}[^<>{}()=;]*)(?=<|\{|$)/u;
const attr = /\b(aria-label|title|placeholder|alt|label|hint|text)="([^"]*\p{L}[^"]*)"/u;
const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('i18n-ignore') || line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      const text = jsxText.exec(line);
      // Ignore generics/arrows like `=> a < b` by requiring the match to look like JSX text.
      if (text) {
        problems.push(`${file.replace(root, 'web/src/')}:${i + 1}: text "${text[1].trim()}"`);
      }
      const a = attr.exec(line);
      if (a) problems.push(`${file.replace(root, 'web/src/')}:${i + 1}: ${a[1]}="${a[2]}"`);
    });
}
if (problems.length) {
  console.error('Hard-coded UI text (move it to web/src/i18n/locales/en.ts):\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`i18n: ${files.length} files clean`);
