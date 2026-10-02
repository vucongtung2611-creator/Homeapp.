import { useState } from 'preact/hooks';
import { api, type Household } from '../api.js';
import { navigate, type Session } from '../router.js';
import { Avatar, Spinner, toast, toastError } from '../ui.js';
import { ROLE, viDate } from '../util.js';

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

  const makeInvite = () => run('invite', async () => setInvite(await api('POST', `/api/households/${home.id}/invite`)));

  const share = async () => {
    if (!invite) return;
    const text = `Vào nhà “${home.name}” với mình nhé: ${invite.url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: home.name, text, url: invite.url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    await copy();
  };
  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      toast('Đã sao chép link');
    } catch {
      toast('Hãy nhấn giữ link để sao chép');
    }
  };

  return (
    <div class="page">
      <h2 class="section-title">Mời người ở chung</h2>
      <section class="card">
        {!home.canInvite ? (
          <p class="muted" style={{ margin: 0 }}>
            Chỉ thành viên trong nhà mới mời được người khác.
          </p>
        ) : invite ? (
          <>
            <p style={{ margin: 0 }}>Gửi link này cho người ở chung qua Zalo, Messenger…</p>
            <div class="link-box" data-testid="invite-link">
              {invite.url}
            </div>
            <div class="row">
              <button class="btn" onClick={share}>
                Chia sẻ
              </button>
              <button class="btn secondary" onClick={copy}>
                Sao chép
              </button>
            </div>
            <p class="hint">
              Hết hạn {viDate(invite.expiresAt)}. Tạo link mới thì link cũ hết hiệu lực.{' '}
              <button
                class="btn ghost small"
                style={{ padding: 0, minHeight: 0 }}
                onClick={() =>
                  run('revoke', async () => {
                    await api('DELETE', `/api/households/${home.id}/invite`);
                    setInvite(undefined);
                    toast('Đã huỷ link mời');
                  })
                }
              >
                Huỷ link
              </button>
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>Ai có link sẽ vào được nhà sau khi tạo tài khoản. Link dùng được 7 ngày.</p>
            <button class="btn block" onClick={makeInvite} disabled={busy === 'invite'}>
              {busy === 'invite' ? <Spinner /> : 'Tạo link mời'}
            </button>
          </>
        )}
      </section>

      <h2 class="section-title">Thành viên ({home.members.length})</h2>
      <section class="card">
        {home.members.map((m) => (
          <div class="member" key={m.id}>
            <Avatar id={m.id} name={m.name} />
            <span style={{ flex: 1 }}>
              {m.name}
              {m.id === me.id && ' (bạn)'}
              <span class="muted" style={{ display: 'block', fontSize: 15 }}>
                {ROLE[m.role] ?? m.role}
              </span>
            </span>
            {isOwner && m.id !== me.id && (
              <button
                class="btn small danger"
                disabled={busy === m.id}
                onClick={() => {
                  if (!confirm(`Mời ${m.name} rời khỏi nhà? Họ sẽ không xem được chat, thư viện và hóa đơn nữa.`)) return;
                  void run(m.id, async () => {
                    await api('DELETE', `/api/households/${home.id}/members/${m.id}`);
                    reloadHome();
                  });
                }}
              >
                Mời ra
              </button>
            )}
          </div>
        ))}
      </section>

      {isOwner && home.hasSamples && (
        <>
          <h2 class="section-title">Dữ liệu mẫu</h2>
          <section class="card">
            <p style={{ marginTop: 0 }}>Xoá các ghi chú, hóa đơn và tin nhắn mẫu khi bạn đã quen.</p>
            <button
              class="btn block secondary"
              disabled={busy === 'samples'}
              onClick={() =>
                run('samples', async () => {
                  await api('DELETE', `/api/households/${home.id}/samples`);
                  reloadHome();
                  toast('Đã xoá dữ liệu mẫu');
                })
              }
            >
              Xoá dữ liệu mẫu
            </button>
          </section>
        </>
      )}

      <h2 class="section-title">Nhà của bạn</h2>
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
            {h.id === home.id && <span class="badge ok">Đang xem</span>}
          </button>
        ))}
        <button class="btn block secondary" style={{ marginTop: 12 }} onClick={() => navigate('/new')}>
          Tạo nhà mới
        </button>
      </section>

      <h2 class="section-title">Tài khoản</h2>
      <section class="card">
        <p style={{ marginTop: 0 }}>
          {session.user?.name}
          <span class="muted" style={{ display: 'block', fontSize: 15 }}>
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
          Đăng xuất
        </button>
        {!isOwner && (
          <button
            class="btn block ghost"
            style={{ color: 'var(--danger)', marginTop: 8 }}
            onClick={() => {
              if (!confirm(`Rời khỏi “${home.name}”?`)) return;
              void run('leave', async () => {
                await api('DELETE', `/api/households/${home.id}/members/${me.id}`);
                await session.refresh();
                navigate('/', true);
              });
            }}
          >
            Rời khỏi nhà này
          </button>
        )}
      </section>
      <p class="hint" style={{ textAlign: 'center', marginTop: 24 }}>
        Bản dùng thử · Góp ý cứ nhắn trong chat nhé 💚
      </p>
    </div>
  );
}
