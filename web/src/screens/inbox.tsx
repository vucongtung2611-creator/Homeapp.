import { useEffect, useState } from 'preact/hooks';
import { api, type Household, type InviteLink, type Invites } from '../api.js';
import { CharacterAvatar } from '../characters.js';
import { formatDate, t, type MessageKey } from '../i18n/index.js';
import type { Live } from '../router.js';
import { EmptyState, ErrorState, Skeleton, Spinner, toast, toastError, useLoad } from '../ui.js';
import { Illustration } from '../illustrations.js';
import { roleLabel } from '../util.js';

export interface InboxEvent {
  from?: string | null;
  days?: number | null;
  id: string;
  kind: string;
  actorName: string | null;
  subjectName: string | null;
  actorIsMe: boolean;
  subjectIsMe: boolean;
  label: string | null;
  role: string | null;
  via: string | null;
  createdAt: string;
  unread: boolean;
}

const EVENT_KINDS = [
  'invite_created', 'invite_revoked', 'code_created', 'code_revoked', 'approval_on', 'approval_off',
  'join_requested', 'request_declined', 'request_cancelled', 'member_joined', 'member_approved', 'member_left', 'member_removed',
  'role_changed', 'owner_transferred', 'guest_expired', 'chat_renamed',
] as const;

/** One line of the inbox, in the reader's language. */
export function eventText(e: InboxEvent): string {
  // Always third person (grammar stays right in every language); your own name is marked.
  const actor = e.actorIsMe ? t('inbox.you', { name: e.actorName ?? '' }) : (e.actorName ?? '?');
  const subject = e.subjectIsMe ? t('inbox.you', { name: e.subjectName ?? '' }) : (e.subjectName ?? '?');
  const kind = e.kind === 'member_joined' && e.actorName ? 'member_approved' : e.kind;
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) return kind;
  const params = { actor, subject, label: e.label || t('settings.someone'), role: e.role ? roleLabel(e.role) : '' };
  if (kind === 'role_changed' && e.role === 'guest' && e.days) return t('inbox.event.role_guest', { ...params, count: e.days });
  if (kind === 'join_requested') return t(e.via === 'code' ? 'inbox.event.join_requested_code' : 'inbox.event.join_requested_link', params);
  return t(`inbox.event.${kind}` as MessageKey, params);
}

/**
 * The home inbox: people waiting to come in, invites and what became of
 * them, and what happened in the home. Opening it marks everything read.
 */
export function InboxScreen({ home, live, reloadHome }: { home: Household; live: Live; reloadHome: () => void }) {
  const data = useLoad(() => api<{ events: InboxEvent[] }>('GET', `/api/households/${home.id}/inbox`), [home.id]);
  const manager = home.canInvite;
  useEffect(() => live.on((e) => (e.type === 'changed' && (e.area === 'inbox' || e.area === 'requests')) || e.type === 'resync' ? void data.reload(true) : undefined), [live]);
  // Seeing the list is reading it.
  useEffect(() => {
    if (!data.data) return;
    if (data.data.events.some((e) => e.unread) || home.unreadInbox) {
      api('POST', `/api/households/${home.id}/inbox/read`).then(reloadHome, () => {});
    }
  }, [data.data]);

  return (
    <div class="page">
      {manager && home.pendingRequests > 0 && <RequestsCard home={home} reloadHome={reloadHome} />}
      {manager && <SentInvites home={home} />}
      <h2 class="section-title">{t('inbox.news')}</h2>
      {data.error ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : !data.data ? (
        <Skeleton rows={3} />
      ) : data.data.events.length === 0 ? (
        <EmptyState art={<Illustration.chat />} title={t('inbox.emptyTitle')} text={t('inbox.emptyText')} />
      ) : (
        <section class="card" data-testid="inbox-events">
          {data.data.events.map((e) => (
            <div class={`event ${e.unread ? 'unread' : ''}`} key={e.id}>
              <span class="who">{eventText(e)}</span>
              <span class="muted when">{formatDate(e.createdAt, 'short')}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Personal invites the managers sent, with what became of each. */
function SentInvites({ home }: { home: Household }) {
  const data = useLoad(() => api<Invites>('GET', `/api/households/${home.id}/invites`), [home.id, home.pendingRequests, home.members.length]);
  const links = data.data?.links ?? [];
  if (!links.length) return null;
  const status = (l: InviteLink) =>
    l.status === 'used'
      ? l.outcome === 'waiting'
        ? t('inbox.inviteWaiting', { name: l.usedBy ?? '?' })
        : l.outcome === 'declined'
          ? t('inbox.inviteDeclined', { name: l.usedBy ?? '?' })
          : l.outcome === 'left'
            ? t('inbox.inviteLeft', { name: l.usedBy ?? '?' })
            : t('inbox.inviteUsed', { name: l.usedBy ?? '?' })
      : l.status === 'pending'
        ? t('inbox.invitePending', { date: formatDate(l.expiresAt, 'short') })
        : l.status === 'expired'
          ? t('settings.inviteStatus.expired')
          : t('settings.inviteStatus.revoked');
  return (
    <>
      <h2 class="section-title">{t('inbox.sent')}</h2>
      <section class="card" data-testid="sent-invites">
        {links.slice(0, 12).map((l) => (
          <div class="event" key={l.id}>
            <span class="who">
              {l.label || t('settings.someone')}
              <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                {roleLabel(l.role)} · {t('inbox.sentBy', { name: l.invitedBy, date: formatDate(l.createdAt, 'short') })}
              </span>
            </span>
            <span class={`badge ${l.outcome === 'accepted' ? 'ok' : l.outcome === 'waiting' ? 'warn' : l.status === 'pending' ? '' : 'muted'}`}>{status(l)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

/** People who used the short code and wait for the owner to let them in. */
export function RequestsCard({ home, reloadHome }: { home: Household; reloadHome: () => void }) {
  type Request = { id: string; name: string; email: string; avatar: string | null; role: string; via: 'code' | 'link'; inviteLabel: string; guestDays: number | null; createdAt: string };
  const list = useLoad(() => api<{ requests: Request[]; roles: string[]; guestDays: number[] }>('GET', `/api/households/${home.id}/requests`), [home.id, home.pendingRequests]);
  const [busy, setBusy] = useState<string>();
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [stays, setStays] = useState<Record<string, number>>({});
  const decide = async (r: Request, decision: 'approve' | 'decline') => {
    if (decision === 'decline' && !confirm(t('requests.declineConfirm', { name: r.name }))) return;
    setBusy(r.id);
    try {
      const role = roles[r.id] ?? r.role;
      await api('POST', `/api/households/${home.id}/requests/${r.id}/${decision}`, decision === 'approve' ? { role, guestDays: role === 'guest' ? (stays[r.id] ?? r.guestDays ?? 7) : undefined } : {});
      toast(decision === 'approve' ? t('requests.approved', { name: r.name }) : t('requests.declined', { name: r.name }));
      reloadHome();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <h2 class="section-title">{t('requests.title')}</h2>
      <section class="card" data-testid="join-requests">
        {(list.data?.requests ?? []).map((r) => (
          <div class="request" key={r.id}>
            <CharacterAvatar id={r.avatar ?? undefined} size={40} mood="still" />
            <span class="who">
              {r.name}
              <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                {r.email}
              </span>
              <span class="muted" style={{ display: 'block', fontSize: 14 }}>
                {r.via === 'code' ? t('requests.viaCode') : t('requests.viaLink', { name: r.inviteLabel || t('settings.someone') })} · {formatDate(r.createdAt, 'short')}
              </span>
              {(list.data?.roles.length ?? 0) > 1 && (
                <select
                  class="input"
                  style={{ marginTop: 6 }}
                  aria-label={t('settings.inviteRole')}
                  value={roles[r.id] ?? r.role}
                  onChange={(e) => setRoles({ ...roles, [r.id]: e.currentTarget.value })}
                >
                  {list.data!.roles.map((x) => (
                    <option key={x} value={x}>
                      {roleLabel(x)}
                    </option>
                  ))}
                </select>
              )}
              {(roles[r.id] ?? r.role) === 'guest' && (
                <select
                  class="input"
                  style={{ marginTop: 6 }}
                  aria-label={t('settings.guestStay')}
                  value={stays[r.id] ?? r.guestDays ?? 7}
                  onChange={(e) => setStays({ ...stays, [r.id]: Number(e.currentTarget.value) })}
                >
                  {list.data!.guestDays.map((d) => (
                    <option key={d} value={d}>
                      {t('settings.stayFor', { count: d })}
                    </option>
                  ))}
                </select>
              )}
            </span>
            <span class="actions">
              <button class="btn small" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>
                {t('requests.approve')}
              </button>
              <button class="btn small ghost" disabled={busy === r.id} onClick={() => decide(r, 'decline')}>
                {t('requests.decline')}
              </button>
            </span>
          </div>
        ))}
        {list.loading && !list.data && <Spinner />}
      </section>
    </>
  );
}

/** The owner's home log: everything, newest first (who came, who invited whom, roles, removals). */
export function LogScreen({ home }: { home: Household }) {
  const data = useLoad(() => api<{ events: InboxEvent[] }>('GET', `/api/households/${home.id}/log`), [home.id]);
  return (
    <div class="page">
      <p class="muted">{t('log.intro')}</p>
      {data.error ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : !data.data ? (
        <Skeleton rows={4} />
      ) : (
        <section class="card" data-testid="home-log">
          {data.data.events.map((e) => (
            <div class="event" key={e.id}>
              <span class="who">{eventText(e)}</span>
              <span class="muted when">{formatDate(e.createdAt, 'short')}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
