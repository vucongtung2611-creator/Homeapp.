import { useState } from 'preact/hooks';
import { api, type Household } from '../api.js';
import { CharacterAvatar, CharacterPicker } from '../characters.js';
import { formatDate, t } from '../i18n/index.js';
import { LanguageSwitch } from '../language.js';
import { navigate, type Session } from '../router.js';
import { Spinner, toast, toastError } from '../ui.js';
import { roleLabel } from '../util.js';

export function SettingsScreen({ home, session, reloadHome }: { home: Household; session: Session; reloadHome: () => void }) {
  const [invite, setInvite] = useState<{ url: string; expiresAt: string }>();
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

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      toast(t('settings.copied'));
    } catch {
      toast(t('settings.copyFallback'));
    }
  };
  const share = async () => {
    if (!invite) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: home.name, text: t('settings.shareText', { home: home.name, url: invite.url }), url: invite.url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <div class="page">
      <h2 class="section-title">{t('settings.invite')}</h2>
      <section class="card">
        {!home.canInvite ? (
          <p class="muted" style={{ margin: 0 }}>
            {t('settings.inviteNotAllowed')}
          </p>
        ) : invite ? (
          <>
            <p style={{ margin: 0 }}>{t('settings.inviteShare')}</p>
            <div class="link-box" data-testid="invite-link">
              {invite.url}
            </div>
            <div class="row">
              <button class="btn" onClick={share}>
                {t('settings.share')}
              </button>
              <button class="btn secondary" onClick={copy}>
                {t('settings.copy')}
              </button>
            </div>
            <p class="hint">
              {t('settings.inviteExpires', { date: formatDate(invite.expiresAt, 'medium') })}{' '}
              <button
                class="btn ghost small"
                style={{ padding: 0, minHeight: 0, textDecoration: 'underline' }}
                onClick={() =>
                  run('revoke', async () => {
                    await api('DELETE', `/api/households/${home.id}/invite`);
                    setInvite(undefined);
                    toast(t('settings.revoked'));
                  })
                }
              >
                {t('settings.revoke')}
              </button>
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>{t('settings.inviteIntro')}</p>
            <button
              class="btn block"
              onClick={() => run('invite', async () => setInvite(await api('POST', `/api/households/${home.id}/invite`)))}
              disabled={busy === 'invite'}
            >
              {busy === 'invite' ? <Spinner /> : t('settings.createInvite')}
            </button>
          </>
        )}
      </section>

      <h2 class="section-title">{t('settings.members', { count: home.members.length })}</h2>
      <section class="card">
        {home.members.map((m) => (
          <div class="member" key={m.id}>
            <CharacterAvatar id={m.avatar} size={40} mood={m.id === me.id ? 'idle' : 'still'} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {m.id === me.id ? t('common.youSuffix', { name: m.name }) : m.name}
              <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                {roleLabel(m.role)}
              </span>
            </span>
            {isOwner && m.id !== me.id && (
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
            )}
          </div>
        ))}
      </section>

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
        <button class="btn block secondary" style={{ marginTop: 12 }} onClick={() => navigate('/new')}>
          {t('settings.newHome')}
        </button>
      </section>

      <h2 class="section-title">{t('settings.account')}</h2>
      <section class="card">
        <p style={{ marginTop: 0 }}>
          {session.user?.name}
          <span class="muted" style={{ display: 'block', fontSize: 14 }}>
            {session.user?.email}
          </span>
        </p>
        <button
          class="btn block secondary"
          onClick={() =>
            run('logout', async () => {
              await api('POST', '/api/auth/logout');
              await session.refresh();
              navigate('/', true);
            })
          }
        >
          {t('settings.logout')}
        </button>
        {!isOwner && (
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
