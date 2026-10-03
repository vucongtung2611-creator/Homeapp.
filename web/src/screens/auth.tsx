import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_CHARACTER, MASCOT } from '../../../src/characters.js';
import { api, ApiError, type JoinRequest } from '../api.js';
import { CharacterAvatar, CharacterPicker } from '../characters.js';
import { currencyName, getLocale, t } from '../i18n/index.js';
import { Illustration } from '../illustrations.js';
import { LanguageSwitch } from '../language.js';
import { navigate, type Session } from '../router.js';
import { Spinner, toast, toastError, useLoad } from '../ui.js';
import { errorText } from '../util.js';

const Logo = () => <img class="logo" src="/icon-192.png" alt="" width={56} height={56} />;

/** Shared frame for the signed-out screens: logo + language switch on top. */
function Frame({ children, back }: { children: ComponentChildren; back?: () => void }) {
  return (
    <main class="welcome">
      <div class="top">
        {back ? (
          <button class="btn ghost small" onClick={back}>
            ← {t('common.back')}
          </button>
        ) : (
          <Logo />
        )}
        <LanguageSwitch />
      </div>
      <div class="body">{children}</div>
    </main>
  );
}

/** "Manage · Assist · Together · Everyday" with the M-A-T-E initials emphasised. */
function Acronym() {
  return (
    <p class="acronym">
      {t('app.acronym')
        .split(' · ')
        .map((word, i) => (
          <span key={word}>
            {i > 0 && ' · '}
            <b>{word.charAt(0)}</b>
            {word.slice(1)}
          </span>
        ))}
    </p>
  );
}

export function WelcomeScreen() {
  return (
    <Frame>
      <div class="mascot">
        <CharacterAvatar id={MASCOT} size={72} mood="wave" />
        <div class="speech">{t('characters.hello')}</div>
      </div>
      <h1 class="wordmark">{t('app.name')}</h1>
      <Acronym />
      <p class="lead" style={{ marginBottom: 8, color: 'var(--text)' }}>
        {t('app.tagline')}
      </p>
      <p class="lead">{t('welcome.lead')}</p>
      <div class="feature">
        <span class="emoji">💬</span>
        <div>
          <strong>{t('welcome.chatTitle')}</strong>
          <p>{t('welcome.chatText')}</p>
        </div>
      </div>
      <div class="feature">
        <span class="emoji">📚</span>
        <div>
          <strong>{t('welcome.libraryTitle')}</strong>
          <p>{t('welcome.libraryText')}</p>
        </div>
      </div>
      <div class="feature">
        <span class="emoji">🧾</span>
        <div>
          <strong>{t('welcome.billsTitle')}</strong>
          <p>{t('welcome.billsText')}</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn block" onClick={() => navigate('/signup')}>
          {t('welcome.start')}
        </button>
        <button class="btn block ghost" onClick={() => navigate('/login')}>
          {t('welcome.haveAccount')}
        </button>
      </div>
    </Frame>
  );
}

export function AuthScreen(props: { mode: 'login' | 'signup'; next?: string; session: Session; compact?: boolean; add?: boolean }) {
  const [mode, setMode] = useState(props.add ? 'login' : props.mode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState(DEFAULT_CHARACTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const add = props.add || undefined;
      if (mode === 'signup') await api('POST', '/api/auth/signup', { name, email, password, avatar, add });
      else await api('POST', '/api/auth/login', { email, password, add });
      // Adding an account: start clean in it (the other one stays one tap away in Settings).
      if (props.add) return location.assign('/');
      await props.session.refresh();
      if (!props.compact) navigate(safeNext(props.next) ?? '/', true);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && err.code === 'email_taken') setMode('login');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={submit} noValidate>
      <div class="segmented" role="group" aria-label={t('auth.tabsLabel')}>
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => (setMode('signup'), setError(''))}>
          {t('auth.signupTab')}
        </button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => (setMode('login'), setError(''))}>
          {t('auth.loginTab')}
        </button>
      </div>
      {mode === 'signup' && (
        <>
          <label class="field">
            <span>{t('auth.name')}</span>
            <input class="input" name="name" autoComplete="name" value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={60} />
          </label>
          <CharacterPicker value={avatar} onChange={setAvatar} label={t('auth.character')} />
        </>
      )}
      <label class="field">
        <span>{t('auth.email')}</span>
        <input
          class="input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
          required
        />
      </label>
      <label class="field">
        <span>{t('auth.password')}</span>
        <input
          class="input"
          name="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          minLength={8}
          required
        />
        {mode === 'signup' && <p class="hint">{t('auth.passwordHint')}</p>}
      </label>
      {error && (
        <p class="error-text" role="alert">
          {error}
        </p>
      )}
      <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 8 }}>
        {busy ? <Spinner label={t('auth.working')} /> : t('auth.submit')}
      </button>
    </form>
  );

  if (props.compact) return form;
  return (
    <Frame back={() => (props.add ? history.back() : navigate('/'))}>
      <h1>{props.add ? t('accounts.addTitle') : mode === 'signup' ? t('auth.signupTitle') : t('auth.loginTitle')}</h1>
      <p class="lead">{props.add ? t('accounts.addLead') : mode === 'signup' ? t('auth.signupLead') : t('auth.loginLead')}</p>
      {form}
    </Frame>
  );
}

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(next?: string): string | undefined {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : undefined;
}

export function JoinScreen({ token, session }: { token: string; session: Session }) {
  const invite = useLoad(
    () =>
      api<{ householdName: string; inviterName: string; label: string; needsApproval: boolean; alreadyMember: boolean; householdId?: string }>(
        'GET',
        `/api/invites/${encodeURIComponent(token)}`,
      ),
    [token, session.user?.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Remember the link until it's used, so signing in by another route still ends up here.
  useEffect(() => {
    if (invite.error || invite.data?.alreadyMember) rememberInvite(undefined);
    else if (!session.user) rememberInvite(token);
  }, [token, invite.error, invite.data, session.user?.id]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<JoinResult>('POST', `/api/invites/${encodeURIComponent(token)}/accept`);
      rememberInvite(undefined);
      await session.refresh();
      // Waiting for the owner: the start screen shows the request and goes in once approved.
      navigate(res.status === 'pending' ? '/start' : `/h/${res.householdId}/chat`, true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Signed up or logged in from this screen: join straight away.
  const wasAnonymous = useRef(!session.user);
  useEffect(() => {
    if (wasAnonymous.current && session.user && invite.data && !invite.data.alreadyMember) {
      wasAnonymous.current = false;
      void accept();
    }
  }, [session.user?.id, invite.data]);

  if (invite.loading && !invite.data)
    return (
      <main class="welcome" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </main>
    );
  if (invite.error)
    return (
      <Frame>
        <div class="state">
          <div class="art">
            <Illustration.link />
          </div>
          <h2>{t('join.invalidTitle')}</h2>
          <p>{errorText(invite.error)}</p>
          {session.user ? (
            <button class="btn secondary" onClick={() => navigate('/start')}>
              {t('join.tryCode')}
            </button>
          ) : (
            <button class="btn secondary" onClick={() => navigate('/')}>
              {t('common.goHome')}
            </button>
          )}
        </div>
      </Frame>
    );
  const data = invite.data!;
  return (
    <Frame>
      <h1>{data.inviterName ? t('join.invitedBy', { name: data.inviterName }) : t('join.invited')}</h1>
      <p class="lead">{t('join.lead', { home: data.householdName })}</p>
      {data.alreadyMember && data.householdId ? (
        <button class="btn block" onClick={() => navigate(`/h/${data.householdId}/chat`, true)}>
          {t('join.alreadyMember')}
        </button>
      ) : session.user ? (
        <>
          <button class="btn block" onClick={accept} disabled={busy}>
            {busy ? <Spinner /> : data.needsApproval ? t('join.askAs', { name: session.user.name }) : t('join.joinAs', { name: session.user.name })}
          </button>
          {data.needsApproval && <p class="hint">{t('join.approvalNote')}</p>}
          {error && (
            <p class="error-text" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p class="muted" style={{ marginTop: 0 }}>
            {t('join.needAccount')}
          </p>
          <AuthScreen mode="signup" session={session} compact />
        </>
      )}
    </Frame>
  );
}

type JoinResult = { status: 'member' | 'joined'; householdId: string; householdName: string } | { status: 'pending'; householdId?: undefined; householdName: string };

// ── After signing up: join a home or create one ───────────────────────
const PENDING_INVITE = 'homeapp:pending-invite';
function rememberInvite(token: string | undefined) {
  try {
    if (token) localStorage.setItem(PENDING_INVITE, JSON.stringify({ token, at: Date.now() }));
    else localStorage.removeItem(PENDING_INVITE);
  } catch {}
}
/** An invite link opened in the last day that hasn't been used yet. */
export function pendingInvite(): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_INVITE) ?? 'null') as { token?: string; at?: number } | null;
    if (saved?.token && Date.now() - (saved.at ?? 0) < 86_400_000) return saved.token;
    localStorage.removeItem(PENDING_INVITE);
  } catch {}
  return undefined;
}



/**
 * Shown after signing up (and whenever someone has no home yet), and from
 * Settings to add another home. Never creates a home by itself.
 */
export function StartScreen({ session }: { session: Session }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const join = async (e: Event) => {
    e.preventDefault();
    if (!value.trim()) return setError(t('start.empty'));
    setBusy(true);
    setError('');
    try {
      const res = await api<JoinResult>('POST', '/api/join', { invite: value });
      if (res.status === 'pending') {
        setValue('');
        await session.refresh();
        return;
      }
      await session.refresh();
      navigate(`/h/${res.householdId}/chat`, true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (r: JoinRequest) =>
    api('DELETE', `/api/join-requests/${r.id}`)
      .then(() => session.refresh())
      .catch(toastError);

  return (
    <Frame back={session.households.length ? () => navigate('/') : undefined}>
      <h1>{t('start.title', { name: session.user?.name.split(/\s+/)[0] ?? '' })}</h1>
      <p class="lead">{t('start.lead')}</p>

      {session.requests.filter((r) => r.status !== 'approved').map((r) => (
        <div key={r.id} class={`banner ${r.status === 'pending' ? 'info' : ''}`} role="status" data-testid="join-request">
          <span style={{ flex: 1 }}>
            {r.status === 'pending' ? t('start.waiting', { home: r.householdName }) : t('start.declined', { home: r.householdName })}
          </span>
          <button class="btn ghost small" onClick={() => dismiss(r)}>
            {r.status === 'pending' ? t('start.cancelRequest') : t('start.hide')}
          </button>
        </div>
      ))}

      <section class="card stack">
        <h2>{t('start.joinTitle')}</h2>
        <p class="muted">{t('start.joinText')}</p>
        <form onSubmit={join} noValidate class="stack">
          <input
            class="input"
            name="invite"
            aria-label={t('start.joinTitle')}
            placeholder={t('start.joinPlaceholder')}
            autoComplete="off"
            autoCapitalize="characters"
            spellcheck={false}
            value={value}
            onInput={(e) => setValue(e.currentTarget.value)}
          />
          {error && (
            <p class="error-text" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button class="btn block" type="submit" disabled={busy}>
            {busy ? <Spinner /> : t('start.joinButton')}
          </button>
        </form>
      </section>

      <p class="or">{t('start.or')}</p>

      <section class="card stack">
        <h2>{t('start.createTitle')}</h2>
        <p class="muted">{t('start.createText')}</p>
        <button class="btn block secondary" data-testid="start-create" onClick={() => navigate('/new')}>
          {t('start.createButton')}
        </button>
      </section>

      {!session.households.length && (
        <button
          class="btn block ghost"
          style={{ marginTop: 16 }}
          onClick={() =>
            api('POST', '/api/auth/logout')
              .then(() => session.refresh())
              .then(() => navigate('/', true))
              .catch(toastError)
          }
        >
          {t('settings.logout')}
        </button>
      )}
    </Frame>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'SGD', 'VND', 'JPY', 'KRW'] as const;

function guessCurrency(): string {
  const tag = navigator.language || 'en-US';
  const region = tag.split('-')[1]?.toUpperCase();
  const byRegion: Record<string, string> = { VN: 'VND', AU: 'AUD', US: 'USD', GB: 'GBP', NZ: 'NZD', SG: 'SGD', CA: 'CAD', JP: 'JPY', KR: 'KRW' };
  const euro = ['DE', 'FR', 'AT', 'BE', 'NL', 'IT', 'ES', 'IE', 'PT', 'FI', 'LU'];
  if (region && byRegion[region]) return byRegion[region]!;
  if (region && euro.includes(region)) return 'EUR';
  if (tag.startsWith('vi')) return 'VND';
  if (tag.startsWith('de') || tag.startsWith('fr')) return 'EUR';
  return 'USD';
}

export function CreateHomeScreen({ session }: { session: Session }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(guessCurrency);
  const [kind, setKind] = useState<'share_house' | 'family'>('share_house');
  const [samples, setSamples] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ id: string }>('POST', '/api/households', {
        name: name.trim() || t('create.defaultName'),
        currency,
        kind,
        samples,
        locale: getLocale(),
      });
      await session.refresh();
      navigate(`/h/${res.id}/chat`, true);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Frame back={() => (history.length > 1 ? history.back() : navigate('/start'))}>
      <h1>{t('create.title')}</h1>
      <p class="lead">{t('create.lead')}</p>
      <form onSubmit={submit}>
        <label class="field">
          <span>{t('create.name')}</span>
          <input class="input" name="homeName" placeholder={t('create.namePlaceholder')} value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={60} />
        </label>
        <div class="segmented" role="group" aria-label={t('create.kindLabel')}>
          <button type="button" aria-pressed={kind === 'share_house'} onClick={() => setKind('share_house')}>
            {t('create.kindShare')}
          </button>
          <button type="button" aria-pressed={kind === 'family'} onClick={() => setKind('family')}>
            {t('create.kindFamily')}
          </button>
        </div>
        <label class="field">
          <span>{t('create.currency')}</span>
          <select class="input" name="currency" value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
            {CURRENCIES.map((code) => (
              <option value={code} key={code}>
                {currencyName(code)} ({code})
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.currentTarget.checked)} />
          {t('create.samples')}
        </label>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 20 }}>
          {busy ? <Spinner /> : t('create.submit')}
        </button>
      </form>
    </Frame>
  );
}
