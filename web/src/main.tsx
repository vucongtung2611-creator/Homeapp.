import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, type Household, type User } from './api.js';
import { AuthScreen, CreateHomeScreen, JoinScreen, WelcomeScreen } from './screens/auth.js';
import { BillsScreen } from './screens/bills.js';
import { ChatScreen } from './screens/chat.js';
import { LibraryScreen } from './screens/library.js';
import { SettingsScreen } from './screens/settings.js';
import { CharacterAvatar } from './characters.js';
import { onLocaleChange, t, tPick } from './i18n/index.js';
import { ErrorState, Icon, Skeleton, Spinner, Toasts, useLoad } from './ui.js';
import { partOfDay } from './util.js';

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
  const me = useLoad(() => api<{ user: User | null; households: Session['households'] }>('GET', '/api/me'), []);
  const session: Session | undefined = me.data && { ...me.data, refresh: () => me.reload(true) as Promise<void> };

  if (me.loading && !me.data) {
    return (
      <div class="welcome" style={{ alignItems: 'center' }}>
        <Spinner />
      </div>
    );
  }
  if (me.error || !session) return <ErrorState error={me.error} onRetry={() => me.reload()} />;

  const url = new URL(path, location.origin);
  const parts = url.pathname.split('/').filter(Boolean);
  const next = url.searchParams.get('next') ?? undefined;

  if (parts[0] === 'join' && parts[1]) return <JoinScreen token={parts[1]} session={session} />;
  if (parts[0] === 'login' || parts[0] === 'signup') {
    if (session.user) return <Redirect to={next ?? '/'} />;
    return <AuthScreen mode={parts[0]} next={next} session={session} />;
  }
  if (!session.user) {
    if (parts.length) return <Redirect to={`/login?next=${encodeURIComponent(url.pathname)}`} />;
    return <WelcomeScreen />;
  }
  if (parts[0] === 'new') return <CreateHomeScreen session={session} />;
  if (parts[0] === 'h' && parts[1]) {
    const tab = (parts[2] ?? 'chat') as Tab;
    return <HomeShell key={parts[1]} householdId={parts[1]} tab={tab} session={session} />;
  }
  // "/" for a signed-in user: last home, first home, or create one.
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_HOME);
  } catch {}
  const target = session.households.find((h) => h.id === last) ?? session.households[0];
  return <Redirect to={target ? `/h/${target.id}/chat` : '/new'} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

// ── Household shell with bottom tabs ─────────────────────────────────
export type Tab = 'chat' | 'library' | 'bills' | 'settings';


function useLive(householdId: string): Live {
  const listeners = useMemo(() => new Set<Listener>(), [householdId]);
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lostAt = 0;
    let stopped = false;
    const emit = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        listeners.forEach((fn) => fn(data));
      } catch {}
    };
    const connect = () => {
      es = new EventSource(`/api/households/${householdId}/events`);
      es.addEventListener('ready', () => {
        setConnected(true);
        // Catch up on anything missed while disconnected.
        if (lostAt) listeners.forEach((fn) => fn({ type: 'resync' }));
        lostAt = 0;
      });
      for (const type of ['message', 'message_deleted', 'changed']) es.addEventListener(type, emit as EventListener);
      es.onerror = () => {
        if (!lostAt) lostAt = Date.now();
        // EventSource retries by itself; flag the banner only if it takes a while.
        setTimeout(() => !stopped && lostAt && Date.now() - lostAt > 2500 && setConnected(false), 3000);
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && es?.readyState === EventSource.CLOSED) connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [householdId]);
  return { on: (fn) => (listeners.add(fn), () => listeners.delete(fn)), connected };
}

function HomeShell(props: { householdId: string; tab: Tab; session: Session }) {
  const { householdId, tab, session } = props;
  const home = useLoad(() => api<Household>('GET', `/api/households/${householdId}`), [householdId]);
  const live = useLive(householdId);
  const [unread, setUnread] = useState(false);

  useEffect(() => rememberHome(householdId), [householdId]);
  useEffect(
    () =>
      live.on((e) => {
        if (e.type === 'message' && tab !== 'chat' && e.message?.userId !== session.user?.id) setUnread(true);
        if (e.type === 'changed' && (e.area === 'members' || e.area === 'household')) home.reload(true);
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
  const titles: Record<Tab, string> = { chat: t('tabs.chat'), library: t('tabs.library'), bills: t('tabs.bills'), settings: t('tabs.settings') };
  const firstName = session.user?.name.split(/\s+/)[0] ?? '';
  const subtitle = tab === 'chat' && h ? tPick(`greeting.${partOfDay()}`, greetingSeed, { name: firstName }) : (h?.name ?? ' ');

  return (
    <div class="app">
      <header class="topbar">
        {tab === 'settings' ? (
          <button class="icon-btn" aria-label={t('common.back')} onClick={() => (history.length > 1 ? history.back() : navigate(`/h/${householdId}/chat`))}>
            <Icon.back />
          </button>
        ) : null}
        {tab === 'chat' && h && <CharacterAvatar id={session.user?.avatar} size={40} mood="wave" />}
        <h1>
          {titles[tab]}
          <span class="sub">{subtitle}</span>
        </h1>
        {tab !== 'settings' && (
          <button class="icon-btn" aria-label={t('tabs.settingsAria')} onClick={() => navigate(`/h/${householdId}/settings`)}>
            <Icon.gear />
          </button>
        )}
      </header>
      {!live.connected && <div class="banner" style={{ margin: '0 20px 10px' }}>{t('live.reconnecting')}</div>}
      {!h ? (
        <div class="page">
          <Skeleton />
        </div>
      ) : tab === 'chat' ? (
        <ChatScreen home={h} live={live} />
      ) : tab === 'library' ? (
        <LibraryScreen home={h} live={live} />
      ) : tab === 'bills' ? (
        <BillsScreen home={h} live={live} />
      ) : (
        <SettingsScreen home={h} session={session} reloadHome={() => home.reload(true)} />
      )}
      <nav class="tabbar" aria-label={t('tabs.nav')}>
        <TabLink to={`/h/${householdId}/chat`} active={tab === 'chat'} label={t('tabs.chat')} icon={<Icon.chat />} dot={unread} />
        <TabLink to={`/h/${householdId}/library`} active={tab === 'library'} label={t('tabs.library')} icon={<Icon.library />} />
        <TabLink to={`/h/${householdId}/bills`} active={tab === 'bills'} label={t('tabs.bills')} icon={<Icon.bill />} />
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

render(<Root />, document.getElementById('app')!);
