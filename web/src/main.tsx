import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, type Household, type User } from './api.js';
import { AuthScreen, CreateHomeScreen, JoinScreen, StartScreen, WelcomeScreen, pendingInvite } from './screens/auth.js';
import { BillsScreen } from './screens/bills.js';
import { ChatScreen } from './screens/chat.js';
import { LibraryScreen } from './screens/library.js';
import { SettingsScreen } from './screens/settings.js';
import { InboxScreen, LogScreen } from './screens/inbox.js';
import { CharacterAvatar } from './characters.js';
import { onLocaleChange, t, tPick } from './i18n/index.js';
import { ErrorState, Icon, Skeleton, Spinner, Toasts, toast, useLoad } from './ui.js';
import { partOfDay } from './util.js';

import { Tour, tourDone } from './tour.js';
import { applyTheme } from './theme.js';
import { bindRouter, navigate, type Listener, type Live, type Session } from './router.js';

const LAST_HOME = 'homeapp:last-home';
export const rememberHome = (id: string) => {
  try {
    localStorage.setItem(LAST_HOME, id);
  } catch {}
};

function App() {
  const [path, setP] = useState(location.pathname + location.search);
  bindRouter(setP);
  const me = useLoad(() => api<{ user: User | null; households: Session['households']; requests: Session['requests']; config?: Session['config'] }>('GET', '/api/me'), []);
  const session: Session | undefined = me.data && { ...me.data, refresh: () => me.reload(true) as Promise<void> };

  if (me.loading && !me.data) {
    return (
      <div class="welcome" style={{ alignItems: 'center' }}>
        <Spinner />
      </div>
    );
  }
  if (me.error || !session) return <ErrorState error={me.error} onRetry={() => me.reload()} />;
  return <Routes path={path} session={session} />;
}

/**
 * Requests to join a home: while one waits, check now and then; when the
 * owner decides, say so once (and go in, if there's nowhere else to be).
 */
function useRequestNews(session: Session, path: string) {
  const waiting = session.requests.some((r) => r.status === 'pending');
  useEffect(() => {
    if (!waiting || !session.user) return;
    const timer = setInterval(() => void session.refresh(), 8000);
    const onFocus = () => void session.refresh();
    window.addEventListener('focus', onFocus);
    return () => (clearInterval(timer), window.removeEventListener('focus', onFocus));
  }, [waiting, session.user?.id]);
  useEffect(() => {
    const onStart = path.startsWith('/start') || path === '/';
    for (const r of session.requests) {
      if (r.status === 'approved') {
        toast(t('start.approved', { home: r.householdName }));
        void api('DELETE', `/api/join-requests/${r.id}`).then(() => session.refresh(), () => {});
        if (onStart && r.householdId) navigate(`/h/${r.householdId}/chat`, true);
      } else if (r.status === 'declined' && !onStart) {
        // On the start screen it's shown as a note to dismiss instead.
        toast(t('start.declined', { home: r.householdName }));
        void api('DELETE', `/api/join-requests/${r.id}`).then(() => session.refresh(), () => {});
      }
    }
  }, [session.requests]);
}

function Routes({ path, session }: { path: string; session: Session }) {
  useRequestNews(session, path);

  const url = new URL(path, location.origin);
  const parts = url.pathname.split('/').filter(Boolean);
  const next = url.searchParams.get('next') ?? undefined;

  if (parts[0] === 'join' && parts[1]) return <JoinScreen token={parts[1]} session={session} />;
  if (parts[0] === 'login' || parts[0] === 'signup') {
    // Signed in already: only shown when adding another account to this browser.
    const adding = url.searchParams.get('add') === '1';
    if (session.user && !adding) return <Redirect to={next ?? '/'} />;
    return <AuthScreen mode={parts[0]} next={next} session={session} add={adding && Boolean(session.user)} />;
  }
  if (!session.user) {
    if (parts.length) return <Redirect to={`/login?next=${encodeURIComponent(url.pathname)}`} />;
    return <WelcomeScreen />;
  }
  // Opened an invite link, then signed in some other way: finish joining first.
  const invite = pendingInvite();
  if (invite && parts[0] !== 'join') return <Redirect to={`/join/${invite}`} />;
  if (parts[0] === 'new') return <CreateHomeScreen session={session} />;
  if (parts[0] === 'start') return <StartScreen session={session} />;
  if (parts[0] === 'h' && parts[1]) {
    const tab = (parts[2] ?? 'chat') as Tab;
    return <HomeShell key={parts[1]} householdId={parts[1]} tab={tab} session={session} />;
  }
  // "/" for a signed-in user: last home, first home, or choose to join or create one.
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_HOME);
  } catch {}
  const target = session.households.find((h) => h.id === last) ?? session.households[0];
  return <Redirect to={target ? `/h/${target.id}/chat` : '/start'} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

// ── Household shell with bottom tabs ─────────────────────────────────
export type Tab = 'chat' | 'library' | 'bills' | 'settings' | 'inbox' | 'log';


/**
 * Live updates over SSE. To save server time (Cloud Run bills while a
 * connection is open) the stream is closed after `idleMs` without a tap,
 * key or scroll, or while the tab is hidden. The next interaction or the
 * tab becoming visible reconnects and fires 'resync' so screens fetch what
 * they missed.
 */
function useLive(householdId: string, idleMs: number): Live {
  const listeners = useMemo(() => new Set<Listener>(), [householdId]);
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lostAt = 0;
    let stopped = false;
    let isPaused = false;
    let lastActivity = Date.now();
    let lastPresence = Date.now();
    let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0;
    const emit = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        listeners.forEach((fn) => fn(data));
      } catch {}
    };
    const mark = (state: string) => document.documentElement.setAttribute('data-live', state);
    const pause = () => {
      if (isPaused || stopped) return;
      isPaused = true;
      es?.close();
      clearTimeout(retry);
      if (!lostAt) lostAt = Date.now();
      setPaused(true);
      setConnected(true);
      mark('paused');
    };
    const connect = () => {
      es?.close();
      mark('connecting');
      es = new EventSource(`/api/households/${householdId}/events`);
      es.addEventListener('ready', () => {
        setConnected(true);
        mark('live');
        // Catch up on anything missed while disconnected.
        if (lostAt) listeners.forEach((fn) => fn({ type: 'resync' }));
        lostAt = 0;
      });
      // The server closes quiet streams; don't let EventSource reconnect by itself.
      es.addEventListener('idle', pause);
      for (const type of ['message', 'message_deleted', 'changed']) es.addEventListener(type, emit as EventListener);
      es.onerror = () => {
        if (isPaused) return;
        if (!lostAt) lostAt = Date.now();
        // EventSource retries by itself; flag the banner only if it takes a while.
        setTimeout(() => !stopped && !isPaused && lostAt && Date.now() - lostAt > 2500 && setConnected(false), 3000);
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, 3000);
        }
      };
    };
    const resume = () => {
      if (!isPaused || stopped) return;
      isPaused = false;
      setPaused(false);
      connect();
    };
    const active = () => {
      lastActivity = Date.now();
      if (document.visibilityState === 'hidden') return;
      if (isPaused) return resume();
      // Tell the server we're still here, so it keeps the stream open.
      if (Date.now() - lastPresence > Math.min(60_000, idleMs / 3)) {
        lastPresence = Date.now();
        api('POST', `/api/households/${householdId}/presence`).catch(() => {});
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
        return;
      }
      hiddenSince = 0;
      active();
      if (!isPaused && es?.readyState === EventSource.CLOSED) connect();
    };
    const check = setInterval(
      () => {
        const now = Date.now();
        if (hiddenSince ? now - hiddenSince >= idleMs : now - lastActivity >= idleMs) pause();
      },
      Math.max(250, Math.min(15_000, idleMs / 6)),
    );
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
    for (const type of events) window.addEventListener(type, active, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibility);
    connect();
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      clearInterval(check);
      for (const type of events) window.removeEventListener(type, active, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      document.documentElement.removeAttribute('data-live');
    };
  }, [householdId, idleMs]);
  return { on: (fn) => (listeners.add(fn), () => listeners.delete(fn)), connected, paused };
}

function HomeShell(props: { householdId: string; tab: Tab; session: Session }) {
  const { householdId, tab, session } = props;
  const home = useLoad(() => api<Household>('GET', `/api/households/${householdId}`), [householdId]);
  const live = useLive(householdId, (session.config?.chatIdleMinutes ?? 3) * 60_000);
  const [unread, setUnread] = useState(false);
  const userId = session.user?.id ?? '';
  const [touring, setTouring] = useState(() => Boolean(userId) && !tourDone(userId));
  useEffect(() => {
    const show = () => setTouring(true);
    window.addEventListener('mate:tour', show);
    return () => window.removeEventListener('mate:tour', show);
  }, []);

  useEffect(() => rememberHome(householdId), [householdId]);
  useEffect(
    () =>
      live.on((e) => {
        if (e.type === 'message' && tab !== 'chat' && e.message?.userId !== session.user?.id) setUnread(true);
        if (e.type === 'changed' && (e.area === 'members' || e.area === 'household' || e.area === 'requests' || e.area === 'inbox')) home.reload(true);
      }),
    [tab, live],
  );
  useEffect(() => {
    if (tab === 'chat') setUnread(false);
  }, [tab]);

  if (home.error) {
    return (
      <div class="app">
        <ErrorState error={home.error} onRetry={() => home.reload()} />
        <div style={{ textAlign: 'center' }}>
          <a href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
            {t('common.goHome')}
          </a>
        </div>
      </div>
    );
  }
  const h = home.data;
  const titles: Record<Tab, string> = { chat: t('tabs.chat'), library: t('tabs.library'), bills: t('tabs.bills'), settings: t('tabs.settings'), inbox: t('inbox.title'), log: t('log.title') };
  const firstName = session.user?.name.split(/\s+/)[0] ?? '';
  const subtitle = tab === 'chat' && h ? tPick(`greeting.${partOfDay()}`, greetingSeed, { name: firstName }) : (h?.name ?? ' ');

  return (
    <div class="app">
      <header class="topbar">
        {tab === 'settings' || tab === 'inbox' || tab === 'log' ? (
          <button class="icon-btn" aria-label={t('common.back')} onClick={() => (history.length > 1 ? history.back() : navigate(`/h/${householdId}/chat`))}>
            <Icon.back />
          </button>
        ) : null}
        {tab === 'chat' && h && <CharacterAvatar id={session.user?.avatar} size={40} mood="wave" />}
        <h1>
          {titles[tab]}
          <span class="sub">{subtitle}</span>
        </h1>
        {tab !== 'inbox' && (
          <button
            class="icon-btn has-dot"
            aria-label={h?.unreadInbox ? t('inbox.unreadAria', { count: h.unreadInbox }) : t('inbox.title')}
            onClick={() => navigate(`/h/${householdId}/inbox`)}
            data-testid="inbox-button"
          >
            <Icon.inbox />
            {h && h.unreadInbox > 0 ? (
              <span class="count" data-testid="inbox-count">
                {h.unreadInbox > 9 ? '9+' : h.unreadInbox}
              </span>
            ) : (
              h && h.pendingRequests > 0 && <span class="dot" data-testid="inbox-dot" />
            )}
          </button>
        )}
        {tab !== 'settings' && (
          <button class="icon-btn" aria-label={t('tabs.settingsAria')} onClick={() => navigate(`/h/${householdId}/settings`)}>
            <Icon.gear />
          </button>
        )}
      </header>
      {live.paused ? (
        <div class="banner info" role="status" style={{ margin: '0 20px 10px' }}>
          {t('live.paused')}
        </div>
      ) : (
        !live.connected && <div class="banner" style={{ margin: '0 20px 10px' }}>{t('live.reconnecting')}</div>
      )}
      {!h ? (
        <div class="page">
          <Skeleton />
        </div>
      ) : tab === 'chat' ? (
        <ChatScreen home={h} live={live} />
      ) : tab === 'library' ? (
        <LibraryScreen home={h} live={live} />
      ) : tab === 'bills' ? (
        h.me.role === 'guest' ? (
          <div class="page">
            <p class="muted">{t('settings.guestNoMoney')}</p>
          </div>
        ) : (
          <BillsScreen home={h} live={live} />
        )
      ) : tab === 'log' ? (
        <LogScreen home={h} />
      ) : tab === 'inbox' ? (
        <InboxScreen home={h} live={live} reloadHome={() => home.reload(true)} />
      ) : (
        <SettingsScreen home={h} session={session} reloadHome={() => home.reload(true)} />
      )}
      {touring && h && <Tour userId={userId} guest={h.me.role === 'guest'} onDone={() => setTouring(false)} />}
      <nav class="tabbar" aria-label={t('tabs.nav')}>
        <TabLink to={`/h/${householdId}/chat`} active={tab === 'chat'} label={t('tabs.chat')} icon={<Icon.chat />} dot={unread} />
        <TabLink to={`/h/${householdId}/library`} active={tab === 'library'} label={t('tabs.library')} icon={<Icon.library />} />
        {h?.me.role !== 'guest' && <TabLink to={`/h/${householdId}/bills`} active={tab === 'bills'} label={t('tabs.bills')} icon={<Icon.bill />} />}
      </nav>
    </div>
  );
}

function TabLink(props: { to: string; active: boolean; label: string; icon: preact.ComponentChildren; dot?: boolean }) {
  return (
    <a
      class="tab"
      href={props.to}
      aria-current={props.active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(props.to, true);
      }}
    >
      {props.icon}
      {props.label}
      {props.dot && <span class="dot" aria-label={t('tabs.newMessages')} />}
    </a>
  );
}

const greetingSeed = Math.floor(Math.random() * 1000);

function Root() {
  const [, setTick] = useState(0);
  useEffect(() => onLocaleChange(() => setTick((n) => n + 1)), []);
  return (
    <>
      <App />
      <Toasts />
    </>
  );
}

applyTheme();
render(<Root />, document.getElementById('app')!);
