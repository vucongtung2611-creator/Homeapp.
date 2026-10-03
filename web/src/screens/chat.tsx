import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, upload, type Conversations, type Household, type Message } from '../api.js';
import { preparePhoto } from '../image.js';
import type { Live } from '../router.js';
import { CharacterAvatar } from '../characters.js';
import { dayLabel, formatDate, formatMoney, formatTime, t, type MessageKey } from '../i18n/index.js';
import { RoomArt } from '../illustrations.js';
import { EmptyState, ErrorState, Icon, Lightbox, Sheet, Skeleton, Spinner, toast, toastError, useLoad } from '../ui.js';
import { errorText } from '../util.js';
import { EMOJI, STICKERS, Sticker } from '../stickers.js';
import { detectWhen } from '../../../src/integrations/when.js';
import { navigate, type Session } from '../router.js';
import { todayIso } from '../util.js';

/** A message naming an upcoming day ("tối mai 7h", "7/10"…) offers to put it on the home calendar. */
function calendarHint(m: Message): { date: string; time?: string } | undefined {
  if (!m.text || m.system || m.sticker || m.text.length > 500) return undefined;
  const sent = new Date(m.createdAt);
  if (Date.now() - sent.getTime() > 14 * 86_400_000) return undefined;
  const when = detectWhen(m.text, sent);
  return when && when.date >= todayIso() ? when : undefined;
}

/** System messages arrive as a key + params and are rendered in the reader's language. */
function systemText(system: NonNullable<Message['system']>): string {
  const p = system.params ?? {};
  const amount = typeof p.amount === 'number' && typeof p.currency === 'string' ? formatMoney(p.amount, p.currency) : undefined;
  const date = typeof p.date === 'string' ? formatDate(p.date) : undefined;
  const key = system.key === 'billAdded' && date ? 'billAddedDue' : system.key;
  return t(`system.${key}` as MessageKey, { ...p, amount, date } as Record<string, string | number | undefined>);
}

/** MATE is Tom, the guide; the others go by their own names. */
export const botName = (id: string) => (id === 'tom' ? t('bots.mate') : t(`characters.${id}.name` as MessageKey));
const whenText = (date?: string, time?: string | null) => `${date ? formatDate(date, 'medium') : ''}${time ? ` ${time}` : ''}`;
const localNow = () => {
  const d = new Date();
  return `${todayIso()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A reply from MATE or a character, in the reader's language. Examples in the help can be tapped to use them. */
function BotBody({ reply, onUse }: { reply: NonNullable<Message['bot']>; onUse: (text: string) => void }) {
  const p = reply.params ?? {};
  const ok = t(`bots.${reply.bot}.ok` as MessageKey);
  const line = (i: Record<string, any>) =>
    i.type === 'item'
      ? `📝 ${i.title}`
      : i.type === 'event' || i.k === 'event'
        ? `📅 ${i.title} — ${whenText(i.date, i.time)}`
        : i.k === 'bill'
          ? `🧾 ${t('bots.s_bill', { title: i.title, date: formatDate(i.date) })}`
          : i.k === 'expiring'
            ? `⏰ ${t('bots.s_expiring', { title: i.title, date: formatDate(i.date) })}`
            : i.k === 'debt'
              ? `💸 ${t('bots.s_debt')}`
              : i.k === 'invite'
                ? `👋 ${t('bots.s_invite')}`
                : `📅 ${t('bots.s_tryCalendar')}`;
  let text: string;
  switch (reply.key) {
    case 'noteSaved':
    case 'noteSavedPrivate':
      text = `${ok} ${t(`bots.${reply.key}` as MessageKey, { title: p.title })}`;
      break;
    case 'eventAdded':
      text = `${ok} ${t('bots.eventAdded', { title: p.title, when: whenText(p.date, p.time) })}`;
      break;
    case 'greeting':
      text = t(`bots.${reply.bot}.greeting` as MessageKey);
      break;
    case 'hello':
      text = `${t('bots.hello', { name: p.name })} ${t(`bots.${reply.bot}.greeting` as MessageKey)}`;
      break;
    default:
      text = t(`bots.${reply.key}` as MessageKey, { query: p.query });
  }
  const examples = ['helpNote', 'helpPrivate', 'helpCalendar', 'helpFind', 'helpUpcoming', 'helpSuggest'] as const;
  return (
    <>
      {text}
      {Array.isArray(p.items) && p.items.length > 0 && (
        <ul class="bot-list">
          {p.items.map((i: Record<string, any>, n: number) => (
            <li key={n}>{line(i)}</li>
          ))}
        </ul>
      )}
      {(reply.key === 'help' || reply.key === 'greeting') && (
        <ul class="bot-list examples">
          {examples.map((k) => (
            <li key={k}>
              <button type="button" class="link-btn" onClick={() => onUse(t(`bots.${k}`))}>
                {t(`bots.${k}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const SEEN_KEY = (hid: string) => `homeapp:seen:${hid}`;
function seenMap(hid: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY(hid)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
function markSeen(hid: string, conversation: string, seq: number) {
  try {
    const map = seenMap(hid);
    if ((map[conversation] ?? 0) >= seq) return;
    map[conversation] = seq;
    localStorage.setItem(SEEN_KEY(hid), JSON.stringify(map));
  } catch {}
}

/** A message as shown: confirmed by the server, or still on its way. */
interface Shown extends Message {
  pending?: boolean;
  failed?: string;
  localUrl?: string;
  retry?: () => void;
}

export function ChatScreen({ home, live, session, conversation = 'group' }: { home: Household; live: Live; session: Session; conversation?: string }) {
  const me = home.me.id;
  const bot = conversation.startsWith('bot:') ? conversation.slice(4) : undefined;
  const other = conversation.startsWith('dm:') ? conversation.slice(3) : undefined;
  /** How the server stores this conversation, to tell incoming messages apart. */
  const storedKey = bot ? `bot:${bot}:${me}` : other ? `dm:${[me, other].sort().join(':')}` : null;
  const partner = bot ? botName(bot) : (home.members.find((m) => m.id === other)?.name ?? '');
  const url = (extra = '') => {
    const q = [conversation === 'group' ? '' : `conversation=${encodeURIComponent(conversation)}`, extra].filter(Boolean).join('&');
    return `/api/households/${home.id}/messages${q ? `?${q}` : ''}`;
  };
  const [picking, setPicking] = useState(false);
  const [unreadElsewhere, setUnreadElsewhere] = useState(false);
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
      const res = await api<{ messages: Message[]; hasMore: boolean }>('GET', url());
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
          if (((e.message as Message).conversation ?? null) !== storedKey) {
            if ((e.message as Message).userId !== me) setUnreadElsewhere(true);
            return;
          }
          stick.current = isNearBottom(listRef.current);
          if ((e.message as Message).userId !== me) fresh.current.add((e.message as Message).id);
          merge([e.message as Message]);
        } else if (e.type === 'message_deleted') {
          setMessages((cur) => cur.filter((m) => m.id !== e.id));
        } else if (e.type === 'resync') {
          try {
            const res = await api<{ messages: Message[] }>('GET', url(`after=${lastSeq.current}`));
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
  useEffect(() => {
    if (lastSeq.current) markSeen(home.id, conversation, lastSeq.current);
  }, [messages]);

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
      const res = await api<{ messages: Message[]; hasMore: boolean }>('GET', url(`before=${first.seq}`));
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

  const send = (sticker?: string, typed?: string) => {
    const body = sticker ? '' : (typed ?? text).trim();
    const pic = sticker ? undefined : photo;
    if (!body && !pic && !sticker) return;
    setPanel(undefined);
    if (!sticker && typed === undefined) {
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
        const saved = await api<Message>('POST', `/api/households/${home.id}/messages`, {
          ...(sticker ? { sticker } : { text: body, fileId }),
          ...(conversation === 'group' ? {} : { conversation }),
          ...(bot ? { localTime: localNow() } : {}),
        });
        setMessages((cur) => cur.filter((m) => m.id !== localId));
        merge([saved]);
        // The character's answer also comes live; fetch it too in case the live connection is paused.
        if (bot) merge((await api<{ messages: Message[] }>('GET', url(`after=${saved.seq}`))).messages);
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

  /** Tapping an example: commands that need more words go into the box, the rest are sent. */
  const useExample = (example: string) => {
    if (/[:：]\s*$|…$|\s$/.test(example)) {
      setText(example.replace(/…$/, ''));
      requestAnimationFrame(() => inputRef.current?.focus());
    } else send(undefined, example);
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
      <ChatName home={home} rename={conversation === 'group'}>
        <button class="conv-btn" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-label={t('chat.pick')} data-testid="conversation-picker">
          {bot ? (
            <CharacterAvatar id={bot} size={28} mood="still" />
          ) : other ? (
            <CharacterAvatar id={home.members.find((m) => m.id === other)?.avatar} size={28} mood="still" />
          ) : (
            <span aria-hidden="true">💬</span>
          )}
          <span class="name">{bot || other ? partner : (home.chatName ?? home.name)}</span>
          <span aria-hidden="true" class="caret">▾</span>
          {unreadElsewhere && <span class="dot" aria-label={t('chat.unread')} />}
        </button>
      </ChatName>
      {(bot || other) && (
        <p class="chat-note" data-testid="chat-note">
          {bot ? '🤖 ' : '🔒 '}
          {bot ? t('chat.botNote', { name: partner }) : t('chat.privateNote', { name: partner })}
        </p>
      )}
      <div class="messages" ref={listRef} aria-live="polite">
        {state === 'loading' && (
          <div style={{ padding: '8px 4px' }}>
            <Skeleton rows={5} />
          </div>
        )}
        {state === 'error' && <ErrorState error={loadError} onRetry={load} />}
        {/* Each character says hello in their own way; this greeting is not stored. */}
        {state === 'ready' && bot && (
          <div class="msg">
            <span class="avatar-slot">
              <CharacterAvatar id={bot} size={30} title={partner} mood="wave" />
            </span>
            <div class="col">
              <span class="who">{partner}</span>
              <div class="bubble" data-testid="bot-greeting">
                <BotBody reply={{ bot, key: 'greeting' }} onUse={useExample} />
              </div>
            </div>
          </div>
        )}
        {state === 'ready' && messages.length === 0 && !bot && (
          <EmptyState
            art={other ? <span class="big-emoji">🔒</span> : <RoomArt room="chat" fallback="chat" />}
            title={other ? partner : t('chat.emptyTitle')}
            text={other ? t('chat.privateNote', { name: partner }) : t('chat.emptyText')}
          />
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
                {m.bot ? (
                  <div class={`msg ${fresh.current.has(m.id) ? 'fresh' : ''}`} data-testid="bot-reply">
                    <span class="avatar-slot">
                      <CharacterAvatar id={m.bot.bot} size={30} title={botName(m.bot.bot)} mood={fresh.current.has(m.id) ? 'bounce' : 'still'} />
                    </span>
                    <div class="col">
                      <div class="bubble">
                        <BotBody reply={m.bot} onUse={useExample} />
                      </div>
                      <span class="time">{formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                ) : m.userId === null ? (
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
                      {!m.pending && !m.failed && !bot && home.me.role !== 'guest' && (() => {
                        const when = calendarHint(m);
                        if (!when) return null;
                        const q = new URLSearchParams({ new: '1', date: when.date, time: when.time ?? '', title: m.text.replace(/\s+/g, ' ').slice(0, 120) });
                        return (
                          <button class="cal-chip" data-testid="add-to-calendar" onClick={() => navigate(`/h/${home.id}/calendar?${q}`)}>
                            📅 {t('calendar.fromChat')}
                          </button>
                        );
                      })()}
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
      {bot && (
        <div class="chips bot-chips" role="group" aria-label={partner}>
          {(['chipSuggest', 'chipUpcoming', 'chipNote', 'chipFind'] as const).map((k) => (
            <button type="button" class="chip" key={k} onClick={() => useExample(t(`bots.${k}`))}>
              {t(`bots.${k}`).trim()}
            </button>
          ))}
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
          placeholder={bot ? t('chat.placeholderBot', { name: partner }) : other ? t('chat.placeholderPerson', { name: partner }) : t('chat.placeholder')}
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
      {picking && <ConversationSheet home={home} session={session} current={conversation} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Who to chat with: this home's group, MATE and the characters, each person here, and people from my other homes. */
function ConversationSheet(props: { home: Household; session: Session; current: string; onClose: () => void }) {
  const { home, session } = props;
  const data = useLoad(() => api<Conversations>('GET', `/api/households/${home.id}/conversations`), [home.id]);
  const seen = seenMap(home.id);
  const go = (c: string, hid = home.id) => {
    props.onClose();
    navigate(`/h/${hid}/chat${c === 'group' ? '' : `?c=${c}`}`);
  };
  const preview = (last: Conversations['group']['last'], name: string) =>
    !last
      ? t('chat.noMessagesYet')
      : last.photo
        ? t('chat.photo')
        : last.sticker
          ? t('chat.sticker')
          : last.bot
            ? `${name} ${t('chat.botReplied')}`
            : `${last.mine ? `${t('chat.you')}: ` : ''}${last.text || '…'}`;
  const row = (key: string, c: string, avatar: preact.ComponentChildren, name: string, sub: string, last: Conversations['group']['last'] | null, hid?: string) => (
    <li key={key}>
      <button class="list-item conv-row" aria-current={c === props.current && !hid ? 'true' : undefined} onClick={() => go(c, hid)} data-testid={`conv-${c}`}>
        {avatar}
        <span class="grow">
          <span class="title">{name}</span>
          <span class="meta">{sub}</span>
        </span>
        {last && !last.mine && last.seq > (seen[c] ?? 0) && c !== props.current && <span class="dot" aria-label={t('chat.unread')} />}
      </button>
    </li>
  );
  return (
    <Sheet title={t('chat.conversations')} onClose={props.onClose}>
      {session.households.length > 1 && (
        <label class="field">
          <span>{t('chat.whichHome')}</span>
          <select class="input" value={home.id} data-testid="chat-home" onChange={(e) => (props.onClose(), navigate(`/h/${e.currentTarget.value}/chat`))}>
            {session.households.map((h) => (
              <option key={h.id} value={h.id}>
                🏠 {h.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!data.data ? (
        data.error ? <ErrorState error={data.error} onRetry={() => data.reload()} /> : <Skeleton rows={4} />
      ) : (
        <>
          <h3 class="section-title">{t('chat.groupSection')}</h3>
          <ul class="list">{row('group', 'group', <span class="conv-emoji">💬</span>, home.chatName ?? home.name, preview(data.data.group.last, ''), data.data.group.last)}</ul>
          {data.data.people.length > 0 && (
            <>
              <h3 class="section-title">{t('chat.peopleSection')}</h3>
              <ul class="list">
                {data.data.people.map((p) => row(p.id, `dm:${p.id}`, <CharacterAvatar id={p.avatar} size={36} mood="still" />, p.name, preview(p.last, p.name), p.last))}
              </ul>
            </>
          )}
          <h3 class="section-title">{t('chat.botsSection')}</h3>
          <ul class="list">
            {data.data.bots.map((b) =>
              row(b.id, `bot:${b.id}`, <CharacterAvatar id={b.id} size={36} mood="still" />, botName(b.id), b.last ? preview(b.last, botName(b.id)) : t(`characters.${b.id}.description` as MessageKey), b.last),
            )}
          </ul>
          {data.data.elsewhere.length > 0 && (
            <>
              <h3 class="section-title">{t('chat.elsewhereSection')}</h3>
              <ul class="list">
                {data.data.elsewhere.map((p) => row(`x-${p.id}`, `dm:${p.id}`, <CharacterAvatar id={p.avatar} size={36} mood="still" />, p.name, t('chat.inHome', { home: p.householdName }), null, p.householdId))}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function isNearBottom(_el: HTMLElement | null): boolean {
  const el = document.scrollingElement;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}

/** The group chat's name; owners and managers can change it. */
function ChatName({ home, rename, children }: { home: Household; rename: boolean; children: preact.ComponentChildren }) {
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
      {children}
      {rename && home.canInvite && (
        <button class="btn small ghost" aria-label={t('chat.rename')} onClick={() => (setDraft(home.chatName ?? ''), setEditing(true))}>
          ✎
        </button>
      )}
    </div>
  );
}
