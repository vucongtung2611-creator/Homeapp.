import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MASCOT } from '../../src/characters.js';
import { CharacterAvatar } from './characters.js';
import { t, type MessageKey } from './i18n/index.js';
import { navigate } from './router.js';

const KEY = (userId: string) => `homeapp:tour-done:${userId}`;

/** Whether this person has seen (or skipped) the short guide on this device. */
export function tourDone(userId: string): boolean {
  try {
    return localStorage.getItem(KEY(userId)) === '1';
  } catch {
    return true; // no storage (private mode): don't nag on every visit
  }
}

/** Show the guide again (from Settings). */
export function replayTour(userId: string) {
  try {
    localStorage.removeItem(KEY(userId));
  } catch {}
  window.dispatchEvent(new Event('mate:tour'));
}

/** One stop on the guided tour: the screen to jump to and the thing on it to point at. */
const STEPS = [
  { id: 'chat', tab: 'chat', target: '[data-tour="composer"]', emoji: '💬' },
  { id: 'calendar', tab: 'calendar', target: '[data-tour="calendar-view"]', emoji: '🗓️' },
  { id: 'library', tab: 'library', target: '[data-tour="tab-library"]', emoji: '📚' },
  { id: 'bills', tab: 'bills', target: '[data-tour="tab-bills"]', emoji: '🧾' },
  { id: 'inbox', tab: 'inbox', target: '.topbar h1', emoji: '📥' },
  { id: 'settings', tab: 'settings', target: '[data-tour="language"] .lang-switch', emoji: '⚙️' },
] as const;

/** Find the element to point at; the screen may still be loading, so keep looking for a moment. */
function useTarget(selector: string, key: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    setRect(null);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      const el = document.querySelector(selector);
      if (el) {
        // Bring it near the top, clear of the guide card at the bottom (bars that stay put are left alone).
        if (!el.closest('.tabbar, .composer, .topbar')) {
          const top = el.getBoundingClientRect().top;
          window.scrollBy({ top: top - 150, behavior: 'instant' as ScrollBehavior });
        }
        setRect(el.getBoundingClientRect());
      } else if (++tries < 30) timer = setTimeout(find, 100);
    };
    find();
    const again = () => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, [selector, key]);
  return rect;
}

/**
 * A guided tour: each step jumps to the real screen and points at the real
 * thing on it, one section at a time. Phone-first: one thumb, big buttons.
 * It can be closed at any time and replayed with the ? button or from Settings.
 */
export function Tour({ userId, householdId, guest, onDone }: { userId: string; householdId: string; guest: boolean; onDone: () => void }) {
  const steps = STEPS.filter((s) => !(guest && s.id === 'bills'));
  const [i, setI] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const rect = useTarget(step.target, step.id);
  const finish = () => {
    try {
      localStorage.setItem(KEY(userId), '1');
    } catch {}
    navigate(`/h/${householdId}/chat`, true);
    onDone();
  };
  // Jump to this step's screen.
  useEffect(() => navigate(`/h/${householdId}/${step.tab}`, true), [step.id]);
  useEffect(() => next.current?.focus({ preventScroll: true }), [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pad = 6;
  const onTop = rect ? rect.top + rect.height / 2 > window.innerHeight * 0.55 : false;
  return (
    <div class={`tour ${onTop ? 'top' : ''} ${rect ? 'pointing' : 'dim'}`} role="dialog" aria-modal="false" aria-labelledby="tour-title" data-testid="tour">
      {rect && (
        <div
          class="tour-spot"
          aria-hidden="true"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      <div class="tour-card">
        <div class="tour-top">
          <CharacterAvatar id={MASCOT} size={44} mood={i === 0 ? 'wave' : 'idle'} />
          <span class="tour-emoji" aria-hidden="true">
            {step.emoji}
          </span>
          <button class="btn ghost small tour-close" onClick={finish}>
            {t('tour.close')}
          </button>
        </div>
        <h2 id="tour-title">{t(`tour.${step.id}.title` as MessageKey)}</h2>
        <p>{t(`tour.${step.id}.text` as MessageKey)}</p>
        <div class="tour-dots" role="img" aria-label={t('tour.progress', { step: i + 1, total: steps.length })}>
          {steps.map((s, n) => (
            <span key={s.id} class={n === i ? 'on' : ''} />
          ))}
        </div>
        <div class="row">
          {i > 0 && (
            <button class="btn ghost" onClick={() => setI(i - 1)}>
              {t('common.back')}
            </button>
          )}
          <button ref={next} class="btn" style={{ flex: 1 }} onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
