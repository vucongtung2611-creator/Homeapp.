import { useEffect, useState } from 'preact/hooks';
import { api, type Household, type InviteLink, type Invites, type Member } from '../api.js';
import { CharacterAvatar, CharacterPicker } from '../characters.js';
import { formatDate, t } from '../i18n/index.js';
import { LanguageSwitch } from '../language.js';
import { navigate, type Session } from '../router.js';
import { Spinner, toast, toastError, useLoad } from '../ui.js';
import { roleLabel } from '../util.js';
import { replayTour } from '../tour.js';

export function SettingsScreen({ home, session, reloadHome }: { home: Household; session: Session; reloadHome: () => void }) {
  const [busy, setBusy] = useState<string>();
  const me = home.me;
  const isOwner = me.role === 'owner';

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div class="page">
      {home.pendingRequests > 0 && (
        <button class="banner info" style={{ width: '100%', border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => navigate(`/h/${home.id}/inbox`)}>
          {t('inbox.waitingBanner', { count: home.pendingRequests })}
        </button>
      )}

      <h2 class="section-title">{t('settings.invite')}</h2>
      <section class="card">
        {home.canInvite ? (
          <InviteCard home={home} reloadHome={reloadHome} />
        ) : (
          <p class="muted" style={{ margin: 0 }}>
            {t('settings.inviteNotAllowed')}
          </p>
        )}
      </section>

      <h2 class="section-title">{t('settings.members', { count: home.members.length })}</h2>
      <Members home={home} reloadHome={reloadHome} />

      <h2 class="section-title">{t('settings.character')}</h2>
      <section class="card">
        <CharacterPicker
          value={session.user?.avatar ?? ''}
          label={t('settings.character')}
          hideLabel
          onChange={(avatar) =>
            run('avatar', async () => {
              await api('PATCH', '/api/me', { avatar });
              await session.refresh();
              reloadHome();
              toast(t('settings.characterSaved'));
            })
          }
        />
      </section>

      <h2 class="section-title">{t('language.label')}</h2>
      <section class="card">
        <LanguageSwitch block />
      </section>
      <button
        class="btn block ghost"
        style={{ marginTop: 8 }}
        onClick={() => {
          if (session.user) replayTour(session.user.id);
          navigate(`/h/${home.id}/chat`);
        }}
      >
        {t('tour.replay')}
      </button>

      {isOwner && home.hasSamples && (
        <>
          <h2 class="section-title">{t('settings.samples')}</h2>
          <section class="card">
            <p style={{ marginTop: 0 }}>{t('settings.samplesText')}</p>
            <button
              class="btn block secondary"
              disabled={busy === 'samples'}
              onClick={() =>
                run('samples', async () => {
                  await api('DELETE', `/api/households/${home.id}/samples`);
                  reloadHome();
                  toast(t('settings.samplesCleared'));
                })
              }
            >
              {t('settings.clearSamples')}
            </button>
          </section>
        </>
      )}

      <h2 class="section-title">{t('settings.homes')}</h2>
      <section class="card">
        {session.households.map((h) => (
          <button
            key={h.id}
            class="member"
            style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => navigate(`/h/${h.id}/chat`)}
          >
            <span class="emoji">🏠</span>
            <span style={{ flex: 1 }}>{h.name}</span>
            {h.id === home.id && <span class="badge ok">{t('settings.current')}</span>}
          </button>
        ))}
        <button class="btn block secondary" style={{ marginTop: 12 }} onClick={() => navigate('/start')}>
          {t('settings.newHome')}
        </button>
      </section>

      <h2 class="section-title">{t('settings.account')}</h2>
      <section class="card">
        <Accounts session={session} />
        <button
          class="btn block secondary"
          style={{ marginTop: 8 }}
          onClick={() =>
            run('logout', async () => {
              // Another account on this browser (if any) takes over; start fresh either way.
              await api('POST', '/api/auth/logout');
              location.assign('/');
            })
          }
        >
          {t('settings.logout')}
        </button>
        {home.canDelete && (
          <>
            <p class="hint" style={{ marginBottom: 0 }}>
              {t('settings.deleteHint')}
            </p>
            <button
              class="btn block ghost"
              style={{ color: 'var(--danger)', marginTop: 8 }}
              disabled={busy === 'delete'}
              onClick={() => {
                if (!confirm(t('settings.deleteConfirm', { home: home.name }))) return;
                void run('delete', async () => {
                  await api('DELETE', `/api/households/${home.id}`);
                  await session.refresh();
                  toast(t('settings.deleted'));
                  navigate('/', true);
                });
              }}
            >
              {t('settings.deleteHome')}
            </button>
          </>
        )}
        {(!isOwner || home.members.filter((m) => m.role === 'owner').length > 1) && (
          <button
            class="btn block ghost"
            style={{ color: 'var(--danger)', marginTop: 8 }}
            onClick={() => {
              if (!confirm(t('settings.leaveConfirm', { home: home.name }))) return;
              void run('leave', async () => {
                await api('DELETE', `/api/households/${home.id}/members/${me.id}`);
                await session.refresh();
                navigate('/', true);
              });
            }}
          >
            {t('settings.leave')}
          </button>
        )}
      </section>
      <p class="hint" style={{ textAlign: 'center', marginTop: 24 }}>
        {t('settings.footer')}
      </p>
    </div>
  );
}

/** Personal invite links (one per person, single use) and the shared code. */
function InviteCard({ home, reloadHome }: { home: Household; reloadHome: () => void }) {
  const data = useLoad(() => api<Invites>('GET', `/api/households/${home.id}/invites`), [home.id]);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('');
  const [days, setDays] = useState(7);
  const [fresh, setFresh] = useState<InviteLink>();
  const [busy, setBusy] = useState<string>();
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(undefined);
    }
  };
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast(t('settings.copyFallback'));
    }
  };
  const share = async (link: InviteLink) => {
    const text = t('settings.shareText', { home: home.name, url: link.url ?? '' });
    if (navigator.share) {
      try {
        await navigator.share({ title: home.name, text, url: link.url ?? undefined });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    await copy(link.url ?? '', t('settings.copied'));
  };

  if (!data.data) return <Spinner />;
  const { code, links, roles } = data.data;
  const open = links.filter((l) => l.status === 'pending');
  const past = links.filter((l) => l.status !== 'pending').slice(0, 8);

  return (
    <>
      <p style={{ marginTop: 0 }}>{home.approveJoins ? t('settings.inviteIntroApprove') : t('settings.inviteIntro')}</p>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run('create', async () => {
            const link = await api<InviteLink>('POST', `/api/households/${home.id}/invites`, {
              label: label.trim() || undefined,
              role: role || undefined,
              guestDays: role === 'guest' ? days : undefined,
            });
            setFresh(link);
            setLabel('');
            data.reload(true);
          });
        }}
      >
        <input
          class="input"
          name="inviteLabel"
          aria-label={t('settings.inviteFor')}
          placeholder={t('settings.inviteFor')}
          value={label}
          maxLength={60}
          onInput={(e) => setLabel(e.currentTarget.value)}
        />
        {roles.length > 1 && (
          <select class="input" aria-label={t('settings.inviteRole')} value={role || roles[0]} onChange={(e) => setRole(e.currentTarget.value)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        )}
        {role === 'guest' && (
          <select class="input" aria-label={t('settings.guestStay')} value={days} onChange={(e) => setDays(Number(e.currentTarget.value))}>
            {home.guestDays.map((d) => (
              <option key={d} value={d}>
                {t('settings.stayFor', { count: d })}
              </option>
            ))}
          </select>
        )}
        <button class="btn block" type="submit" disabled={busy === 'create'}>
          {busy === 'create' ? <Spinner /> : t('settings.createInvite')}
        </button>
      </form>

      {fresh?.url && (
        <div class="stack" style={{ marginTop: 14 }}>
          <p style={{ margin: 0 }}>{t('settings.inviteReady', { name: fresh.label || t('settings.someone') })}</p>
          <div class="link-box" data-testid="invite-link">
            {fresh.url}
          </div>
          <div class="row">
            <button class="btn" onClick={() => share(fresh)}>
              {t('settings.share')}
            </button>
            <button class="btn secondary" onClick={() => copy(fresh.url!, t('settings.copied'))}>
              {t('settings.copy')}
            </button>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <>
          <h3 class="subhead">{t('settings.openInvites')}</h3>
          {open.map((l) => (
            <div class="request" key={l.id} data-testid="open-invite">
              <span class="who">
                {l.label || t('settings.someone')}
                <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                  {roleLabel(l.role)} · {t('settings.inviteUntil', { date: formatDate(l.expiresAt, 'short') })}
                </span>
              </span>
              <span class="actions">
                <button class="btn small secondary" onClick={() => copy(l.url!, t('settings.copied'))}>
                  {t('settings.copy')}
                </button>
                <button
                  class="btn small ghost"
                  disabled={busy === l.id}
                  onClick={() => {
                    if (!confirm(t('settings.cancelInviteConfirm', { name: l.label || t('settings.someone') }))) return;
                    void run(l.id, async () => {
                      await api('DELETE', `/api/households/${home.id}/invites/${l.id}`);
                      if (fresh?.id === l.id) setFresh(undefined);
                      data.reload(true);
                      toast(t('settings.revoked'));
                    });
                  }}
                >
                  {t('settings.cancelInvite')}
                </button>
              </span>
            </div>
          ))}
        </>
      )}
      {past.length > 0 && (
        <>
          <h3 class="subhead">{t('settings.pastInvites')}</h3>
          {past.map((l) => (
            <div class="request" key={l.id}>
              <span class="who">
                {l.label || t('settings.someone')}
                <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                  {l.status === 'used' ? (l.outcome === 'waiting' ? t('inbox.inviteWaiting', { name: l.usedBy ?? '?' }) : t('settings.inviteUsedBy', { name: l.usedBy ?? '?' })) : t(l.status === 'expired' ? 'settings.inviteStatus.expired' : 'settings.inviteStatus.revoked')}
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      <h3 class="subhead">{t('settings.codeTitle')}</h3>
      <p style={{ marginTop: 0 }}>{t('settings.codeIntro')}</p>
      {code ? (
        <>
          <div class="code-box" data-testid="invite-code">
            {code.code}
          </div>
          <div class="row" style={{ marginTop: 10 }}>
            <button class="btn secondary" onClick={() => copy(code.code, t('settings.codeCopied'))}>
              {t('settings.copyCode')}
            </button>
            <button
              class="btn ghost"
              disabled={busy === 'code'}
              onClick={() => {
                if (!confirm(t('settings.renewConfirm'))) return;
                void run('code', async () => {
                  await api('POST', `/api/households/${home.id}/code`);
                  data.reload(true);
                  toast(t('settings.renewed'));
                });
              }}
            >
              {t('settings.renew')}
            </button>
          </div>
          <p class="hint">
            {t('settings.inviteExpires', { date: formatDate(code.expiresAt, 'medium') })}{' '}
            <button
              class="btn ghost small"
              style={{ padding: 0, minHeight: 0, textDecoration: 'underline' }}
              onClick={() =>
                run('code', async () => {
                  await api('DELETE', `/api/households/${home.id}/code`);
                  data.reload(true);
                  toast(t('settings.codeOff'));
                })
              }
            >
              {t('settings.revoke')}
            </button>
          </p>
        </>
      ) : (
        <button
          class="btn block secondary"
          disabled={busy === 'code'}
          onClick={() =>
            run('code', async () => {
              await api('POST', `/api/households/${home.id}/code`);
              data.reload(true);
            })
          }
        >
          {t('settings.makeCode')}
        </button>
      )}

      {home.me.role === 'owner' && (
        <label class="check" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={home.approveJoins}
            onChange={(e) => {
              const approveJoins = e.currentTarget.checked;
              api('PATCH', `/api/households/${home.id}`, { approveJoins }).then(() => (reloadHome(), data.reload(true)), toastError);
            }}
          />
          {t('settings.approveJoins')}
        </label>
      )}
    </>
  );
}


/** Who lives here: roles (owner sets them), guests' stay, removing, handing the home over. */
function Members({ home, reloadHome }: { home: Household; reloadHome: () => void }) {
  const me = home.me;
  const isOwner = me.role === 'owner';
  const owners = home.members.filter((m) => m.role === 'owner').length;
  const [busy, setBusy] = useState<string>();
  const [heir, setHeir] = useState('');
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(undefined);
    }
  };
  const canRemove = (m: Member) =>
    m.id !== me.id && (isOwner ? !(m.role === 'owner' && owners === 1) : me.role === 'manager' && !['owner', 'manager'].includes(m.role));
  const setRole = (m: Member, role: string, guestDays?: number) => {
    if (m.role === 'owner' && role !== 'owner' && owners === 1) return toast(t('errors.last_owner'));
    void run(m.id, async () => {
      await api('PATCH', `/api/households/${home.id}/members/${m.id}`, { role, guestDays });
      reloadHome();
      toast(t('settings.roleChanged', { name: m.name, role: roleLabel(role) }));
    });
  };
  const candidates = home.members.filter((m) => m.id !== me.id && m.role !== 'guest');

  return (
    <>
      <section class="card" data-testid="members">
        {home.members.map((m) => (
          <div class="request" key={m.id}>
            <CharacterAvatar id={m.avatar} size={40} mood={m.id === me.id ? 'idle' : 'still'} />
            <span class="who">
              {m.id === me.id ? t('common.youSuffix', { name: m.name }) : m.name}
              {(!isOwner || (m.role === 'guest' && m.expiresAt)) && (
                <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                  {m.role === 'guest' && m.expiresAt ? t('settings.guestUntil', { date: formatDate(m.expiresAt, 'short') }) : roleLabel(m.role)}
                </span>
              )}
              {isOwner && (
                <span class="row" style={{ marginTop: 6, gap: 6 }}>
                  <select
                    class="input small"
                    aria-label={t('settings.roleOf', { name: m.name })}
                    value={m.role}
                    disabled={busy === m.id}
                    onChange={(e) => setRole(m, e.currentTarget.value, e.currentTarget.value === 'guest' ? 7 : undefined)}
                  >
                    {home.roles.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                  {m.role === 'guest' && (
                    <select
                      class="input small"
                      aria-label={t('settings.guestStay')}
                      value=""
                      onChange={(e) => e.currentTarget.value && setRole(m, 'guest', Number(e.currentTarget.value))}
                    >
                      <option value="">{t('settings.extendStay')}</option>
                      {home.guestDays.map((d) => (
                        <option key={d} value={d}>
                          {t('settings.days', { count: d })}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              )}
            </span>
            {canRemove(m) && (
              <span class="actions">
                <button
                  class="btn small danger"
                  disabled={busy === m.id}
                  onClick={() => {
                    if (!confirm(t('settings.removeConfirm', { name: m.name }))) return;
                    void run(m.id, async () => {
                      await api('DELETE', `/api/households/${home.id}/members/${m.id}`);
                      reloadHome();
                    });
                  }}
                >
                  {t('settings.remove')}
                </button>
              </span>
            )}
          </div>
        ))}
      </section>

      {me.role === 'guest' && me.expiresAt && <p class="hint">{t('settings.guestNote', { date: formatDate(me.expiresAt, 'medium') })}</p>}

      {isOwner && (
        <>
          <h2 class="section-title">{t('settings.ownerTools')}</h2>
          <section class="card stack">
            <button class="btn block secondary" onClick={() => navigate(`/h/${home.id}/log`)}>
              {t('log.open')}
            </button>
            <a class="btn block secondary" href={`/api/households/${home.id}/export`} download data-testid="export">
              {t('settings.export')}
            </a>
            <p class="hint" style={{ margin: 0 }}>
              {t('settings.exportHint')}
            </p>
            {candidates.length > 0 && (
              <>
                <p class="muted">{t('settings.transferText')}</p>
                <select class="input" aria-label={t('settings.transferTo')} value={heir} onChange={(e) => setHeir(e.currentTarget.value)}>
                  <option value="">{t('settings.transferTo')}</option>
                  {candidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  class="btn block secondary"
                  disabled={!heir || busy === 'transfer'}
                  onClick={() => {
                    const to = home.members.find((m) => m.id === heir);
                    if (!to || !confirm(t('settings.transferConfirm', { name: to.name, home: home.name }))) return;
                    void run('transfer', async () => {
                      await api('POST', `/api/households/${home.id}/transfer`, { to: to.id });
                      setHeir('');
                      reloadHome();
                      toast(t('settings.transferred', { name: to.name }));
                    });
                  }}
                >
                  {t('settings.transfer')}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Accounts signed in on this browser: switch without signing out, add one, or remove one. */
function Accounts({ session }: { session: Session }) {
  type Account = { id: string; name: string; email: string; avatar: string; active: boolean };
  const list = useLoad(() => api<{ accounts: Account[] }>('GET', '/api/accounts'), [session.user?.id]);
  const [busy, setBusy] = useState<string>();
  const switchTo = async (a: Account) => {
    setBusy(a.id);
    try {
      await api('POST', '/api/accounts/switch', { userId: a.id });
      location.assign('/');
    } catch (err) {
      toastError(err);
      setBusy(undefined);
    }
  };
  const forget = async (a: Account) => {
    if (!confirm(t('accounts.removeConfirm', { name: a.name }))) return;
    try {
      await api('DELETE', `/api/accounts/${a.id}`);
      list.reload(true);
    } catch (err) {
      toastError(err);
    }
  };
  const accounts = list.data?.accounts ?? [];
  return (
    <div data-testid="accounts">
      {accounts.map((a) => (
        <div class="request" key={a.id}>
          <CharacterAvatar id={a.avatar} size={36} mood="still" />
          <span class="who">
            {a.active ? t('common.youSuffix', { name: a.name }) : a.name}
            <span class="muted" style={{ display: 'block', fontSize: 14 }}>
              {a.email}
            </span>
          </span>
          {!a.active && (
            <span class="actions">
              <button class="btn small" disabled={busy === a.id} onClick={() => switchTo(a)}>
                {t('accounts.switch')}
              </button>
              <button class="btn small ghost" aria-label={t('accounts.removeAria', { name: a.name })} onClick={() => forget(a)}>
                ✕
              </button>
            </span>
          )}
        </div>
      ))}
      {accounts.length < 5 && (
        <button class="btn block ghost" style={{ marginTop: 6 }} onClick={() => navigate('/login?add=1')}>
          ＋ {t('accounts.add')}
        </button>
      )}
      <p class="hint" style={{ margin: '4px 0 0' }}>
        {t('accounts.hint')}
      </p>
    </div>
  );
}
