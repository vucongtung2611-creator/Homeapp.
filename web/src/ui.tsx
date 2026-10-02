import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api.js';
import { t } from './i18n/index.js';
import { Illustration } from './illustrations.js';
import { errorText } from './util.js';

// ── Icons (inline, stroke = currentColor) ─────────────────────────────
const svg = (d: ComponentChildren) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icon = {
  chat: () => svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />),
  library: () => svg(<><path d="M4 19.5V5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2Z" /><path d="M6 21h12v-3" /><path d="M9 7h6" /></>),
  bill: () => svg(<><path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" /><path d="M9 7h6M9 11h6M9 15h3" /></>),
  plus: () => svg(<path d="M12 5v14M5 12h14" />),
  send: () => svg(<><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>),
  image: () => svg(<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  camera: () => svg(<><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><circle cx="12" cy="13" r="3.5" /></>),
  gear: () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>),
  close: () => svg(<path d="M18 6 6 18M6 6l12 12" />),
  search: () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  lock: () => svg(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  back: () => svg(<path d="m15 18-6-6 6-6" />),
  file: () => svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /></>),
  check: () => svg(<path d="M20 6 9 17l-5-5" />),
};

// ── Small pieces ─────────────────────────────────────────────────────
export function Spinner({ label }: { label?: string }) {
  return <span class="spinner" role="status" aria-label={label ?? t('common.loading')} />;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="skeleton line" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

export function EmptyState(props: { art: ComponentChildren; title: string; text: string; action?: ComponentChildren }) {
  return (
    <div class="state">
      <div class="art">{props.art}</div>
      <h2>{props.title}</h2>
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.code === 'network';
  return (
    <div class="state" role="alert">
      <div class="art">{offline ? <Illustration.offline /> : <Illustration.search />}</div>
      <p>{errorText(error)}</p>
      {onRetry && (
        <button class="btn secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; name?: string }) {
  return (
    <label class="switch">
      <span class="label">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input type="checkbox" role="switch" name={props.name} checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

// ── Bottom sheet ─────────────────────────────────────────────────────
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; back?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, textarea, button.btn')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <div class="sheet-handle" />
        <div class="sheet-head">
          {props.back && (
            <button class="icon-btn" onClick={props.back} aria-label={t('common.back')}>
              <Icon.back />
            </button>
          )}
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label={t('common.close')}>
            <Icon.close />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────
type ToastMsg = { id: number; text: string; error?: boolean };
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {};
export const toast = (text: string) => pushToast({ text });
export const toastError = (err: unknown) => pushToast({ text: errorText(err), error: true });

export function Toasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      setItems([{ ...t, id }]); // one at a time: the newest replaces the last
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.error ? 4500 : 2600);
    };
  }, []);
  return (
    <div class="toast-wrap" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={`toast ${t.error ? 'error' : ''}`} role={t.error ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div class="lightbox" onClick={onClose} role="dialog" aria-label={t('common.viewPhoto')}>
      <img src={src} alt="" />
    </div>
  );
}

/** Tracks an async load with loading / error / data states. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const reload = (quiet = false) => {
    const mine = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: undefined }));
    return load().then(
      (data) => mine === seq.current && setState({ data, loading: false }),
      (error) => mine === seq.current && setState((s) => ({ ...s, error, loading: false })),
    );
  };
  useEffect(() => {
    setState({ loading: true });
    void reload();
  }, deps);
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) };
}
