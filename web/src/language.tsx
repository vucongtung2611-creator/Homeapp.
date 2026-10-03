import { AVAILABLE, chooseLocale, getLocale, setLocale, t } from './i18n/index.js';
import { LOCALES, type LocaleCode } from './i18n/locales/index.js';

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

/** The "choose a language" prompt in every language we offer, so anyone can recognise their own. */
const promptIn = (code: LocaleCode) => (LOCALES.find((l) => l.code === code)!.messages as { language: { choose: string } }).language.choose;

/** First screen of all: one big button per language, before anything else is shown. */
export function LanguageGate({ onDone }: { onDone: () => void }) {
  return (
    <main class="welcome lang-gate" data-testid="language-gate">
      <div class="body">
        <div class="lang-gate-prompts" aria-hidden="true">
          {AVAILABLE.map((l) => (
            <span key={l.code} lang={l.code}>
              {promptIn(l.code)}
            </span>
          ))}
        </div>
        <h1 class="sr-only">{t('language.choose')}</h1>
        <div class="lang-gate-list" role="group" aria-label={t('language.choose')}>
          {AVAILABLE.map((l) => (
            <button
              key={l.code}
              type="button"
              class={`btn lang-gate-btn ${l.code === getLocale() ? '' : 'secondary'}`}
              lang={l.code}
              aria-pressed={l.code === getLocale()}
              onClick={() => chooseLocale(l.code)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <p class="muted lang-gate-note">{t('language.later')}</p>
        <button type="button" class="btn block" onClick={onDone} data-testid="language-continue">
          {t('language.continue')}
        </button>
      </div>
    </main>
  );
}
