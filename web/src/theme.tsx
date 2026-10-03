import { useState } from 'preact/hooks';
import { t, type MessageKey } from './i18n/index.js';

/** Colour themes; "auto" follows the device's light/dark setting. Remembered per device. */
export const THEMES = ['auto', 'ivory', 'pink', 'blue', 'yellow', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
const KEY = 'homeapp:theme';
/** Preview colours for the picker: background, surface, accent. */
const PREVIEW: Record<Theme, [string, string, string]> = {
  auto: ['#faf9f7', '#171716', '#2f7d68'],
  ivory: ['#f7f3ea', '#fffcf5', '#2f7d68'],
  pink: ['#fbf1f3', '#f5e4e8', '#b0476c'],
  blue: ['#eff5fa', '#e1ecf5', '#2c6aa0'],
  yellow: ['#fbf6e4', '#f3ead0', '#8a6a00'],
  dark: ['#171716', '#272725', '#5cc0a2'],
};

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as Theme | null;
    if (saved && (THEMES as readonly string[]).includes(saved)) return saved;
  } catch {}
  return 'auto';
}

/** Apply a theme to the page (call once at start-up, and on change). */
export function applyTheme(theme: Theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  // Match the browser bar to the page.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#faf9f7');
}

export function ThemePicker() {
  const [theme, setTheme] = useState(getTheme);
  const choose = (next: Theme) => {
    try {
      if (next === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    setTheme(next);
    applyTheme(next);
  };
  return (
    <div class="swatches" role="radiogroup" aria-label={t('theme.label')} data-testid="themes">
      {THEMES.map((name) => (
        <button key={name} class="swatch" role="radio" aria-checked={theme === name} onClick={() => choose(name)}>
          <span class="chip-colors" aria-hidden="true">
            {PREVIEW[name].map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </span>
          {t(`theme.${name}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
