import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, upload, type Household, type Message } from '../api.js';
import { preparePhoto } from '../image.js';
import type { Live } from '../router.js';
import { CharacterAvatar } from '../characters.js';
import { dayLabel, formatDate, formatMoney, formatTime, t, type MessageKey } from '../i18n/index.js';
import { RoomArt } from '../illustrations.js';
import { EmptyState, ErrorState, Icon, Lightbox, Skeleton, Spinner, toast, toastError } from '../ui.js';
import { errorText } from '../util.js';
import { EMOJI, STICKERS, Sticker } from '../stickers.js';

/** System messages arrive as a key + params and are rendered in the reader's language. */
function systemText(system: NonNullable<Message['system']>): string {
  const p = system.params ?? {};
  const amount = typeof p.amount === 'number' && typeof p.currency === 'string' ? formatMoney(p.amount, p.currency) : undefined;
  const date = typeof p.date === 'string' ? formatDate(p.date) : undefined;
  const key = system.key === 'billAdded' && date ? 'billAddedDue' : system.key;
  return t(`system.${key}` as MessageKey, { ...p, amount, date } as Record<string, string | number | undefined>);
}

/** A message as shown: confirmed by the server, or still on its way. */
interface Shown extends Message {
  pending?: boolean;
  failed?: string;
  localUrl?: string;
  retry?: () => void;
}

export function ChatScreen({ home, live }: { home: Household; live: Live }) {
  const me = home.me.id;
  const [messages, setMessages] = useState<Shown[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | undefined>();
  const [lightbox, setLightbox] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  /** Messages that arrived while the screen is open get a small pop-in. */
  const fresh = useRef(new Set<string>());
  const avatarOf = (userId: string | null) => home.members.find((m) => m.id === userId)?.avatar;
  const lastOfGroup = (i: number) => {
    const next = messages[i + 1];
    return !next || next.userId !== messages[i]!.userId || dayLabel(next.createdAt) !== dayLabel(messages[i]!.createdAt);
  };
  const lastSeq = useRef(0);

  const merge = (incoming: Message[]) =>
    setMessages((cur) => {
      const byId = new Map(cur.filter((m) => !m.pending && !m.failed).map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const confirmed = [...byId.values()].sort((a, b) => a.seq - b.seq);
      lastSeq.current = Math.max(lastSeq.current, confirmed.at(-1)?.seq ?? 0);
      return [...confirmed, ...cur.filter((m) => m.pending || m.failed)];
    });

  const load = async () => {
    setState('loading');
    try {
      const res = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/api/households/${home.id}/messages`);
      setMessages([]);
      merge(res.messages);
      setHasMore(res.hasMore);
      setState('ready');
    } catch (err) {
      setLoadError(err);
      setState('error');
    }
  };

  useEffect(() => {
    void load();
  }, [home.id]);

  useEffect(
    () =>
      live.on(async (e) => {
        if (e.type === 'message') {
          stick.current = isNearBottom(listRef.current);
          if ((e.message as Message).userId !== me) fresh.current.add((e.message as Message).id);
          merge([e.message as Message]);
        } else if (e.type === 'message_deleted') {
          setMessages((cur) => cur.filter((m) => m.id !== e.id));
        } else if (e.type === 'resync') {
          try {
            const res = await api<{ messages: Message[] }>('GET', `/api/households/${home.id}/messages?after=${lastSeq.current}`);
            merge(res.messages);
          } catch {}
        }
      }),
    [live, home.id],
  );

  // Keep the newest message in view when we were already at the bottom.
  useLayoutEffect(() => {
    if (stick.current) scrollToBottom();
  }, [messages, state]);

  const scrollToBottom = () => {
    const el = document.scrollingElement;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const loadOlder = async () => {
    const first = messages.find((m) => !m.pending);
    if (!first) return;
    setLoadingOlder(true);
    const before = document.scrollingElement!.scrollHeight;
    try {
      const res = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/api/households/${home.id}/messages?before=${first.seq}`);
      stick.current = false;
      merge(res.messages);
      setHasMore(res.hasMore);
      requestAnimationFrame(() => {
        const el = document.scrollingElement!;
        el.scrollTop += el.scrollHeight - before;
      });
    } catch (err) {
      toastError(err);
    } finally {
      setLoadingOlder(false);
    }
  };

  const [panel, setPanel] = useState<'emoji' | 'stickers'>();
  /** Put an emoji where the cursor is. */
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const next = text.slice(0, at) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + emoji.length;
    });
  };

  const send = (sticker?: string) => {
    const body = sticker ? '' : text.trim();
    const pic = sticker ? undefined : photo;
    if (!body && !pic && !sticker) return;
    setPanel(undefined);
    if (!sticker) {
      setText('');
      setPhoto(undefined);
    }
    if (inputRef.current) inputRef.current.style.height = '';
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic: Shown = {
      id: localId,
      seq: Number.MAX_SAFE_INTEGER,
      userId: me,
      userName: '',
      system: null,
      text: body,
      sticker: sticker ?? null,
      file: null,
      createdAt: new Date().toISOString(),
      pending: true,
      localUrl: pic?.url,
    };
    const attempt = async () => {
      setMessages((cur) => cur.map((m) => (m.id === localId ? { ...m, pending: true, failed: undefined } : m)));
      try {
        let fileId: string | undefined;
        if (pic) {
          const prepared = await preparePhoto(pic.file);
          fileId = (await upload(home.id, prepared.blob, prepared.name)).id;
        }
        const saved = await api<Message>('POST', `/api/households/${home.id}/messages`, sticker ? { sticker } : { text: body, fileId });
        setMessages((cur) => cur.filter((m) => m.id !== localId));
        merge([saved]);
      } catch (err) {
        setMessages((cur) => cur.map((m) => (m.id === localId ? { ...m, pending: false, failed: errorText(err), retry: attempt } : m)));
      }
    };
    stick.current = true;
    fresh.current.add(localId);
    setMessages((cur) => [...cur, optimistic]);
    void attempt();
    inputRef.current?.focus();
  };

  const remove = async (m: Shown) => {
    if (m.failed) {
      setMessages((cur) => cur.filter((x) => x.id !== m.id));
      return;
    }
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
      await api('DELETE', `/api/households/${home.id}/messages/${m.id}`);
      setMessages((cur) => cur.filter((x) => x.id !== m.id));
    } catch (err) {
      toastError(err);
    }
  };

  const pickPhoto = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toastError(new Error('unsupported_file_type'));
    setPhoto({ file, url: URL.createObjectURL(file) });
    inputRef.current?.focus();
  };

  return (
    <div class="page chat-page">
      <ChatName home={home} />
      <div class="messages" ref={listRef} aria-live="polite">
        {state === 'loading' && (
          <div style={{ padding: '8px 4px' }}>
            <Skeleton rows={5} />
          </div>
        )}
        {state === 'error' && <ErrorState error={loadError} onRetry={load} />}
        {state === 'ready' && messages.length === 0 && (
          <EmptyState art={<RoomArt room="chat" fallback="chat" />} title={t('chat.emptyTitle')} text={t('chat.emptyText')} />
        )}
        {state === 'ready' && hasMore && (
          <button class="btn ghost small" style={{ alignSelf: 'center' }} onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? <Spinner /> : t('chat.older')}
          </button>
        )}
        {state === 'ready' &&
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            const mine = m.userId === me;
            const cont = !newDay && prev && prev.userId === m.userId && prev.userId !== null;
            const src = m.localUrl ?? m.file?.url;
            return (
              <Fragment key={m.id}>
                {newDay && <div class="day">{dayLabel(m.createdAt)}</div>}
                {m.userId === null ? (
                  <div class="system">{m.system ? systemText(m.system) : m.text}</div>
                ) : (
                  <div class={`msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${m.failed ? 'failed' : ''} ${fresh.current.has(m.id) ? 'fresh' : ''}`}>
                    {!mine && <span class="avatar-slot">{!lastOfGroup(i) ? null : <CharacterAvatar id={avatarOf(m.userId)} size={30} title={m.userName ?? ''} mood={fresh.current.has(m.id) ? 'bounce' : 'still'} />}</span>}
                    <div class="col">
                      {!mine && !cont && <span class="who">{m.userName}</span>}
                      <div
                        class={`bubble ${src ? 'photo' : ''} ${m.sticker ? 'sticker-bubble' : ''}`}
                        onContextMenu={(e) => {
                          if (mine) {
                            e.preventDefault();
                            void remove(m);
                          }
                        }}
                      >
                        {m.sticker && <Sticker id={m.sticker} />}
                        {src && <img src={src} alt={t('chat.photoAlt')} loading="lazy" onClick={() => setLightbox(src)} />}
                        {m.text && (src ? <div class="caption">{m.text}</div> : m.text)}
                      </div>
                      {m.failed ? (
                        <span>
                          <button class="retry" onClick={() => m.retry?.()}>
                            {t('chat.failed')}
                          </button>
                          <button class="retry" style={{ color: 'var(--muted)' }} onClick={() => remove(m)}>
                            {t('chat.discard')}
                          </button>
                        </span>
                      ) : lastOfGroup(i) || m.pending ? (
                        <span class="time">{m.pending ? t('chat.sending') : formatTime(m.createdAt)}</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
      </div>

      {photo && (
        <div class="preview-strip">
          <img src={photo.url} alt={t('chat.photoPreview')} />
          <span class="muted" style={{ flex: 1 }}>
            {t('chat.photoNote')}
          </span>
          <button class="icon-btn" aria-label={t('chat.removePhoto')} onClick={() => setPhoto(undefined)}>
            <Icon.close />
          </button>
        </div>
      )}
      {panel && (
        <div class="picker" data-testid="picker">
          <div class="segmented" role="tablist">
            <button type="button" role="tab" aria-pressed={panel === 'emoji'} onClick={() => setPanel('emoji')}>
              {t('chat.emojiTab')}
            </button>
            <button type="button" role="tab" aria-pressed={panel === 'stickers'} onClick={() => setPanel('stickers')}>
              {t('chat.stickersTab')}
            </button>
          </div>
          {panel === 'emoji' ? (
            <div class="emoji-grid">
              {EMOJI.map((e) => (
                <button type="button" key={e} onClick={() => insertEmoji(e)} aria-label={e}>
                  {e}
                </button>
              ))}
            </div>
          ) : (
            <div class="sticker-grid">
              {STICKERS.map((st) => (
                <button type="button" key={st.id} onClick={() => send(st.id)} aria-label={t('chat.sendSticker', { name: t(`stickers.${st.id}` as MessageKey) })}>
                  <Sticker id={st.id} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
        <div class="composer-box">
        <button type="button" class="icon-btn" aria-label={t('chat.sendPhoto')} onClick={() => fileRef.current?.click()}>
          <Icon.image />
        </button>
        <button
          type="button"
          class="icon-btn emoji-btn"
          aria-label={t('chat.emojiButton')}
          aria-expanded={Boolean(panel)}
          onClick={() => setPanel(panel ? undefined : 'emoji')}
        >
          {panel ? '⌨️' : '😊'}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.inputLabel')}
          value={text}
          maxLength={4000}
          onInput={(e) => {
            const el = e.currentTarget;
            setText(el.value);
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Enter sends on a keyboard; on phones the send button does.
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" class="send" aria-label={t('chat.send')} disabled={!text.trim() && !photo}>
          <Icon.send />
        </button>
        </div>
      </form>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(undefined)} />}
    </div>
  );
}

function isNearBottom(_el: HTMLElement | null): boolean {
  const el = document.scrollingElement;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}

/** The group chat's name; owners and managers can change it. */
function ChatName({ home }: { home: Household }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const name = home.chatName ?? home.name;
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('PATCH', `/api/households/${home.id}/chat`, { name: draft.trim() });
      setEditing(false);
      toast(t('chat.renamed'));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <form class="chat-head" onSubmit={save}>
        <input
          class="input small"
          style={{ flex: 1 }}
          value={draft}
          maxLength={60}
          aria-label={t('chat.nameLabel')}
          placeholder={home.name}
          onInput={(e) => setDraft(e.currentTarget.value)}
          ref={(el) => el?.focus()}
        />
        <button class="btn small" type="submit" disabled={busy}>
          {t('common.save')}
        </button>
        <button class="btn small ghost" type="button" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </button>
      </form>
    );
  }
  return (
    <div class="chat-head" data-testid="chat-name">
      <span class="name">💬 {name}</span>
      {home.canInvite && (
        <button class="btn small ghost" aria-label={t('chat.rename')} onClick={() => (setDraft(home.chatName ?? ''), setEditing(true))}>
          ✎
        </button>
      )}
    </div>
  );
}
