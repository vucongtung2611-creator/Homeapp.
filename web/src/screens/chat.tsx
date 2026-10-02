import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, upload, type Household, type Message } from '../api.js';
import { preparePhoto } from '../image.js';
import type { Live } from '../router.js';
import { EmptyState, ErrorState, Icon, Lightbox, Skeleton, Spinner, toastError } from '../ui.js';
import { dayLabel, errorText, timeOf } from '../util.js';

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

  const send = () => {
    const body = text.trim();
    const pic = photo;
    if (!body && !pic) return;
    setText('');
    setPhoto(undefined);
    if (inputRef.current) inputRef.current.style.height = '';
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic: Shown = {
      id: localId,
      seq: Number.MAX_SAFE_INTEGER,
      userId: me,
      userName: '',
      text: body,
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
        const saved = await api<Message>('POST', `/api/households/${home.id}/messages`, { text: body, fileId });
        setMessages((cur) => cur.filter((m) => m.id !== localId));
        merge([saved]);
      } catch (err) {
        setMessages((cur) => cur.map((m) => (m.id === localId ? { ...m, pending: false, failed: errorText(err), retry: attempt } : m)));
      }
    };
    stick.current = true;
    setMessages((cur) => [...cur, optimistic]);
    void attempt();
    inputRef.current?.focus();
  };

  const remove = async (m: Shown) => {
    if (m.failed) {
      setMessages((cur) => cur.filter((x) => x.id !== m.id));
      return;
    }
    if (!confirm('Xoá tin nhắn này?')) return;
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
      <div class="messages" ref={listRef} aria-live="polite">
        {state === 'loading' && (
          <div style={{ padding: '8px 4px' }}>
            <Skeleton rows={5} />
          </div>
        )}
        {state === 'error' && <ErrorState error={loadError} onRetry={load} />}
        {state === 'ready' && messages.length === 0 && (
          <EmptyState art="💬" title="Chưa có tin nhắn" text="Gửi lời chào đầu tiên cho cả nhà, hoặc gửi một tấm ảnh." />
        )}
        {state === 'ready' && hasMore && (
          <button class="btn ghost small" style={{ alignSelf: 'center' }} onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? <Spinner /> : 'Xem tin cũ hơn'}
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
                  <div class="system">{m.text}</div>
                ) : (
                  <div class={`msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${m.failed ? 'failed' : ''}`}>
                    {!mine && !cont && <span class="who">{m.userName}</span>}
                    <div
                      class={`bubble ${src ? 'photo' : ''}`}
                      onContextMenu={(e) => {
                        if (mine) {
                          e.preventDefault();
                          void remove(m);
                        }
                      }}
                    >
                      {src && <img src={src} alt="Ảnh" loading="lazy" onClick={() => setLightbox(src)} />}
                      {m.text && (src ? <div class="caption">{m.text}</div> : m.text)}
                    </div>
                    {m.failed ? (
                      <span>
                        <button class="retry" onClick={() => m.retry?.()}>
                          Gửi lỗi · Thử lại
                        </button>
                        <button class="retry" style={{ color: 'var(--muted)' }} onClick={() => remove(m)}>
                          Bỏ
                        </button>
                      </span>
                    ) : (
                      <span class="time">{m.pending ? 'Đang gửi…' : timeOf(m.createdAt)}</span>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
      </div>

      {photo && (
        <div class="preview-strip">
          <img src={photo.url} alt="Ảnh sắp gửi" />
          <span class="muted" style={{ flex: 1 }}>
            Ảnh sẽ được thu nhỏ và xoá thông tin vị trí trước khi gửi.
          </span>
          <button class="icon-btn" aria-label="Bỏ ảnh" onClick={() => setPhoto(undefined)}>
            <Icon.close />
          </button>
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
        <button type="button" class="icon-btn" aria-label="Gửi ảnh" onClick={() => fileRef.current?.click()}>
          <Icon.image />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Nhắn cho cả nhà…"
          aria-label="Tin nhắn"
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
        <button type="submit" class="send" aria-label="Gửi" disabled={!text.trim() && !photo}>
          <Icon.send />
        </button>
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
