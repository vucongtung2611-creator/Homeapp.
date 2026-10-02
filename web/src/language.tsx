import { AVAILABLE, getLocale, setLocale, t } from './i18n/index.js';
import type { LocaleCode } from './i18n/locales/index.js';

/** A visible language switch: a native select (great on phones) dressed as a pill. */
export function LanguageSwitch({ block = false }: { block?: boolean }) {
  if (AVAILABLE.length < 2) return null;
  return (
    <label class={`lang-switch ${block ? 'block' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
      </svg>
      <span class="sr-only">{t('language.choose')}</span>
      <select value={getLocale()} onChange={(e) => setLocale(e.currentTarget.value as LocaleCode)} aria-label={t('language.choose')}>
        {AVAILABLE.map((l) => (
          <option value={l.code} key={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
