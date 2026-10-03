import { useEffect, useRef, useState } from 'preact/hooks';
import { MASCOT } from '../../src/characters.js';
import { CharacterAvatar } from './characters.js';
import { t, type MessageKey } from './i18n/index.js';

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

const STEPS = [
  { id: 'chat', emoji: '💬' },
  { id: 'library', emoji: '📚' },
  { id: 'bills', emoji: '🧾' },
  { id: 'inbox', emoji: '📥' },
] as const;

/** A four-card welcome for people new to a home. Phone-first: one thumb, big buttons, skippable. */
export function Tour({ userId, guest, onDone }: { userId: string; guest: boolean; onDone: () => void }) {
  const steps = STEPS.filter((s) => !(guest && s.id === 'bills'));
  const [i, setI] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const finish = () => {
    try {
      localStorage.setItem(KEY(userId), '1');
    } catch {}
    onDone();
  };
  useEffect(() => next.current?.focus(), [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour">
      <div class="tour-card">
        <div class="tour-top">
          <CharacterAvatar id={MASCOT} size={44} mood={i === 0 ? 'wave' : 'idle'} />
          <span class="tour-emoji" aria-hidden="true">
            {step.emoji}
          </span>
        </div>
        <h2 id="tour-title">{t(`tour.${step.id}.title` as MessageKey)}</h2>
        <p>{t(`tour.${step.id}.text` as MessageKey)}</p>
        <div class="tour-dots" aria-label={t('tour.progress', { step: i + 1, total: steps.length })}>
          {steps.map((s, n) => (
            <span key={s.id} class={n === i ? 'on' : ''} />
          ))}
        </div>
        <div class="row">
          {i > 0 ? (
            <button class="btn ghost" onClick={() => setI(i - 1)}>
              {t('common.back')}
            </button>
          ) : (
            <button class="btn ghost" onClick={finish}>
              {t('tour.skip')}
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
