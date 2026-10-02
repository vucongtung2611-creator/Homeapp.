import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api.js';
import { navigate, type Session } from '../router.js';
import { ErrorState, Spinner, useLoad } from '../ui.js';
import { errorText } from '../util.js';

const Logo = () => <img class="logo" src="/icon-192.png" alt="" width={84} height={84} />;

export function WelcomeScreen() {
  return (
    <main class="welcome">
      <Logo />
      <h1>Nhà mình</h1>
      <p class="lead">Một chỗ chung cho cả nhà: nói chuyện, cất giấy tờ, và chia tiền hóa đơn không cần tính tay.</p>
      <div class="feature">
        <span class="emoji">💬</span>
        <div>
          <strong>Chat chung</strong>
          <p>Tin nhắn và ảnh đến ngay với mọi người trong nhà.</p>
        </div>
      </div>
      <div class="feature">
        <span class="emoji">📚</span>
        <div>
          <strong>Thư viện</strong>
          <p>Mật khẩu Wi-Fi, hợp đồng thuê nhà, ảnh, ghi chú. Tìm lại trong một giây.</p>
        </div>
      </div>
      <div class="feature">
        <span class="emoji">🧾</span>
        <div>
          <strong>Hóa đơn</strong>
          <p>Dán email hoặc chụp hóa đơn, app tự tách số tiền và chia cho mọi người.</p>
        </div>
      </div>
      <div class="actions" style={{ marginTop: 16 }}>
        <button class="btn block" onClick={() => navigate('/signup')}>
          Bắt đầu
        </button>
        <button class="btn block ghost" onClick={() => navigate('/login')}>
          Tôi đã có tài khoản
        </button>
      </div>
    </main>
  );
}

export function AuthScreen(props: { mode: 'login' | 'signup'; next?: string; session: Session; invite?: string; compact?: boolean }) {
  const [mode, setMode] = useState(props.mode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await api('POST', '/api/auth/signup', { name, email, password });
      else await api('POST', '/api/auth/login', { email, password });
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
      <div class="segmented" role="group" aria-label="Chọn">
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => (setMode('signup'), setError(''))}>
          Tạo tài khoản
        </button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => (setMode('login'), setError(''))}>
          Đăng nhập
        </button>
      </div>
      {mode === 'signup' && (
        <label class="field">
          <span>Tên bạn (mọi người trong nhà sẽ thấy)</span>
          <input class="input" name="name" autoComplete="name" value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={60} />
        </label>
      )}
      <label class="field">
        <span>Email</span>
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
        <span>Mật khẩu</span>
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
        {mode === 'signup' && <p class="hint">Ít nhất 8 ký tự.</p>}
      </label>
      {error && (
        <p class="error-text" role="alert">
          {error}
        </p>
      )}
      <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 8 }}>
        {busy ? <Spinner label="Đang xử lý" /> : 'Tiếp tục'}
      </button>
    </form>
  );

  if (props.compact) return form;
  return (
    <main class="welcome">
      <Logo />
      <h1>{mode === 'signup' ? 'Chào bạn 👋' : 'Mừng bạn quay lại'}</h1>
      <p class="lead">{mode === 'signup' ? 'Tạo tài khoản trong 30 giây.' : 'Đăng nhập để vào nhà của bạn.'}</p>
      {form}
    </main>
  );
}

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(next?: string): string | undefined {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : undefined;
}

export function JoinScreen({ token, session }: { token: string; session: Session }) {
  const invite = useLoad(
    () => api<{ householdName: string; inviterName: string; alreadyMember: boolean; householdId?: string }>('GET', `/api/invites/${encodeURIComponent(token)}`),
    [token, session.user?.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ householdId: string }>('POST', `/api/invites/${encodeURIComponent(token)}/accept`);
      await session.refresh();
      navigate(`/h/${res.householdId}/chat`, true);
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
      <main class="welcome" style={{ alignItems: 'center' }}>
        <Spinner />
      </main>
    );
  if (invite.error)
    return (
      <main class="welcome">
        <div class="state">
          <div class="art">🔗</div>
          <h2>Link mời không dùng được</h2>
          <p>{errorText(invite.error)}</p>
          <button class="btn secondary" onClick={() => navigate('/')}>
            Về trang đầu
          </button>
        </div>
      </main>
    );
  const data = invite.data!;
  return (
    <main class="welcome">
      <Logo />
      <h1>{data.inviterName ? `${data.inviterName} mời bạn vào nhà` : 'Bạn được mời vào nhà'}</h1>
      <p class="lead">
        <strong style={{ color: 'var(--text)' }}>{data.householdName}</strong>: chat chung, thư viện và chia tiền hóa đơn.
      </p>
      {data.alreadyMember && data.householdId ? (
        <button class="btn block" onClick={() => navigate(`/h/${data.householdId}/chat`, true)}>
          Bạn đã ở trong nhà này — vào nhà
        </button>
      ) : session.user ? (
        <>
          <button class="btn block" onClick={accept} disabled={busy}>
            {busy ? <Spinner /> : `Vào nhà với tên ${session.user.name}`}
          </button>
          {error && (
            <p class="error-text" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p class="muted" style={{ marginTop: 0 }}>
            Tạo tài khoản hoặc đăng nhập để vào nhà.
          </p>
          <AuthScreen mode="signup" session={session} compact />
        </>
      )}
    </main>
  );
}

const CURRENCIES = [
  ['VND', 'Việt Nam đồng (₫)'],
  ['AUD', 'Đô la Úc (A$)'],
  ['USD', 'Đô la Mỹ ($)'],
  ['EUR', 'Euro (€)'],
  ['GBP', 'Bảng Anh (£)'],
  ['NZD', 'Đô la New Zealand'],
  ['SGD', 'Đô la Singapore'],
  ['CAD', 'Đô la Canada'],
  ['JPY', 'Yên Nhật (¥)'],
  ['KRW', 'Won Hàn (₩)'],
] as const;

function guessCurrency(): string {
  const lang = navigator.language || '';
  const map: Record<string, string> = { AU: 'AUD', US: 'USD', GB: 'GBP', NZ: 'NZD', SG: 'SGD', CA: 'CAD', JP: 'JPY', KR: 'KRW', DE: 'EUR', FR: 'EUR' };
  const region = lang.split('-')[1]?.toUpperCase();
  return (region && map[region]) || 'VND';
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
      const res = await api<{ id: string }>('POST', '/api/households', { name: name || 'Nhà mình', currency, kind, samples });
      await session.refresh();
      navigate(`/h/${res.id}/chat`, true);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <main class="welcome">
      {session.households.length > 0 && (
        <button class="btn ghost" style={{ alignSelf: 'flex-start', marginBottom: 12 }} onClick={() => history.back()}>
          ← Quay lại
        </button>
      )}
      <h1>Tạo nhà của bạn</h1>
      <p class="lead">Sau đó bạn sẽ có một link để mời mọi người vào.</p>
      <form onSubmit={submit}>
        <label class="field">
          <span>Tên nhà</span>
          <input class="input" name="homeName" placeholder="VD: Nhà 12 Lê Lợi" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={60} />
        </label>
        <div class="segmented" role="group" aria-label="Kiểu nhà">
          <button type="button" aria-pressed={kind === 'share_house'} onClick={() => setKind('share_house')}>
            Nhà ở ghép
          </button>
          <button type="button" aria-pressed={kind === 'family'} onClick={() => setKind('family')}>
            Gia đình
          </button>
        </div>
        <label class="field">
          <span>Tiền tệ</span>
          <select class="input" name="currency" value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
            {CURRENCIES.map(([code, label]) => (
              <option value={code} key={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.currentTarget.checked)} />
          Thêm dữ liệu mẫu để thử (xoá được sau)
        </label>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 20 }}>
          {busy ? <Spinner /> : 'Tạo nhà'}
        </button>
      </form>
    </main>
  );
}

export { ErrorState };
