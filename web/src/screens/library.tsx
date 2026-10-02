import { useEffect, useRef, useState } from 'preact/hooks';
import { api, upload, type Household, type Item, type UploadedFile } from '../api.js';
import { isImage, preparePhoto } from '../image.js';
import type { Live } from '../router.js';
import { EmptyState, ErrorState, Icon, Lightbox, Sheet, Skeleton, Spinner, Switch, toast, toastError, useLoad } from '../ui.js';
import { errorText, viDate } from '../util.js';

type Kind = Item['kind'];
const KIND: Record<Kind, { label: string; emoji: string }> = {
  note: { label: 'Ghi chú', emoji: '📝' },
  photo: { label: 'Ảnh', emoji: '🖼️' },
  document: { label: 'Tài liệu', emoji: '📄' },
  link: { label: 'Liên kết', emoji: '🔗' },
};

export function LibraryScreen({ home, live }: { home: Household; live: Live }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>();
  const [kind, setKind] = useState<Kind>();
  const [open, setOpen] = useState<Item>();
  const [editing, setEditing] = useState<{ item?: Item; kind: Kind } | undefined>();
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (tag) params.set('tag', tag);
  if (kind) params.set('kind', kind);
  const data = useLoad(
    () => api<{ items: Item[]; tags: { tag: string; count: number }[] }>('GET', `/api/households/${home.id}/items?${params}`),
    [home.id, query, tag, kind],
  );
  useEffect(() => live.on((e) => (e.type === 'changed' && e.area === 'library') || e.type === 'resync' ? void data.reload(true) : undefined), [live, query, tag, kind]);

  // Keep an open item fresh after edits elsewhere.
  useEffect(() => {
    if (open && data.data) {
      const fresh = data.data.items.find((i) => i.id === open.id);
      if (fresh && fresh.updatedAt !== open.updatedAt) setOpen(fresh);
    }
  }, [data.data]);

  const filtered = Boolean(query || tag || kind);
  const items = data.data?.items ?? [];

  return (
    <div class="page">
      <div class="search">
        <Icon.search />
        <input
          class="input"
          type="search"
          placeholder="Tìm ghi chú, giấy tờ, ảnh…"
          aria-label="Tìm trong thư viện"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      <div class="chips" role="group" aria-label="Lọc">
        <button class="chip" aria-pressed={!kind && !tag} onClick={() => (setKind(undefined), setTag(undefined))}>
          Tất cả
        </button>
        {(['note', 'photo', 'document'] as Kind[]).map((k) => (
          <button class="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)} key={k}>
            {KIND[k].emoji} {KIND[k].label}
          </button>
        ))}
        {data.data?.tags.map((t) => (
          <button class="chip" aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? undefined : t.tag)} key={t.tag}>
            #{t.tag}
          </button>
        ))}
      </div>

      {data.loading && !data.data ? (
        <Skeleton />
      ) : data.error && !data.data ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState art="🔍" title="Không tìm thấy" text="Thử từ khác, hoặc bỏ bộ lọc. Tìm không cần gõ dấu: “hop dong” sẽ ra “hợp đồng”." />
        ) : (
          <EmptyState
            art="📚"
            title="Thư viện còn trống"
            text="Cất mật khẩu Wi-Fi, hợp đồng thuê nhà, ảnh bảo hành… ở đây để cả nhà tìm lại nhanh."
            action={
              <button class="btn" onClick={() => setChoosing(true)}>
                Thêm món đầu tiên
              </button>
            }
          />
        )
      ) : (
        <ul class="list" aria-busy={data.loading}>
          {items.map((item) => (
            <li key={item.id}>
              <button class="list-item" onClick={() => setOpen(item)}>
                <Thumb item={item} />
                <span class="grow">
                  <span class="title">
                    {item.private && (
                      <span aria-label="Riêng tư" title="Chỉ mình bạn thấy" style={{ display: 'inline-block', width: 18, verticalAlign: '-2px', marginRight: 6, color: 'var(--muted)' }}>
                        <Icon.lock />
                      </span>
                    )}
                    {item.title}
                  </span>
                  <span class="meta">
                    {item.body ? item.body.split('\n')[0] : item.attachments.length ? `${item.attachments.length} tệp` : KIND[item.kind].label}
                  </span>
                  {item.tags.length > 0 && (
                    <span style={{ display: 'block', marginTop: 6 }}>
                      {item.tags.slice(0, 3).map((t) => (
                        <span class="tag" key={t}>
                          #{t}
                        </span>
                      ))}
                      {item.sample && <span class="badge">Mẫu</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button class="fab" onClick={() => setChoosing(true)}>
        <Icon.plus /> Thêm
      </button>

      {choosing && (
        <Sheet title="Thêm vào thư viện" onClose={() => setChoosing(false)}>
          <div class="choice-grid">
            {(['note', 'photo', 'document'] as Kind[]).map((k) => (
              <button
                class="choice"
                key={k}
                onClick={() => {
                  setChoosing(false);
                  setEditing({ kind: k });
                }}
              >
                <span class="emoji">{KIND[k].emoji}</span>
                <span>
                  <strong>{KIND[k].label}</strong>
                  <small>{k === 'note' ? 'Mật khẩu, nội quy, số điện thoại…' : k === 'photo' ? 'Ảnh đồ đạc, bảo hành, công tơ…' : 'PDF hợp đồng, hóa đơn, giấy tờ'}</small>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {open && !editing && (
        <ItemSheet
          item={open}
          onClose={() => setOpen(undefined)}
          onEdit={() => setEditing({ item: open, kind: open.kind })}
          onDeleted={() => {
            setOpen(undefined);
            void data.reload(true);
          }}
          home={home}
        />
      )}
      {editing && (
        <EditorSheet
          home={home}
          item={editing.item}
          kind={editing.kind}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setEditing(undefined);
            if (open) setOpen(saved);
            void data.reload(true);
          }}
        />
      )}
    </div>
  );
}

function Thumb({ item }: { item: Item }) {
  const img = item.attachments.find((a) => isImage(a.mime));
  return <span class="emoji">{img ? <img src={img.url} alt="" loading="lazy" /> : KIND[item.kind].emoji}</span>;
}

function ItemSheet(props: { item: Item; home: Household; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { item, home } = props;
  const [lightbox, setLightbox] = useState<string>();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm(`Xoá “${item.title}”?`)) return;
    setBusy(true);
    try {
      await api('DELETE', `/api/households/${home.id}/items/${item.id}`);
      toast('Đã xoá');
      props.onDeleted();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };
  return (
    <Sheet title={item.title} onClose={props.onClose}>
      <p class="muted" style={{ marginTop: -8 }}>
        {KIND[item.kind].emoji} {KIND[item.kind].label} · {item.ownerName} · {viDate(item.updatedAt)}
        {item.private && ' · 🔒 Chỉ mình bạn thấy'}
      </p>
      {item.attachments.filter((a) => isImage(a.mime)).map((a) => (
        <img key={a.fileId} class="photo-full" src={a.url} alt={a.name} onClick={() => setLightbox(a.url)} />
      ))}
      {item.attachments
        .filter((a) => !isImage(a.mime))
        .map((a) => (
          <a key={a.fileId} class="doc-link" href={a.url} target="_blank" rel="noopener">
            <span class="emoji">📄</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
            <span class="muted">{Math.max(1, Math.round(a.size / 1024))} KB</span>
          </a>
        ))}
      {item.body && <div class="card note-body">{item.body}</div>}
      {item.tags.length > 0 && (
        <p>
          {item.tags.map((t) => (
            <span class="tag" key={t}>
              #{t}
            </span>
          ))}
        </p>
      )}
      <div class="row" style={{ marginTop: 16 }}>
        {item.canEdit && (
          <button class="btn secondary" onClick={props.onEdit}>
            Sửa
          </button>
        )}
        {item.canDelete && (
          <button class="btn danger" onClick={remove} disabled={busy}>
            Xoá
          </button>
        )}
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(undefined)} />}
    </Sheet>
  );
}

interface Pending {
  key: string;
  name: string;
  preview?: string;
  progress: number;
  file?: UploadedFile;
  error?: string;
}

function EditorSheet(props: { home: Household; item?: Item; kind: Kind; onClose: () => void; onSaved: (item: Item) => void }) {
  const { home, item } = props;
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [isPrivate, setPrivate] = useState(item?.private ?? false);
  const [files, setFiles] = useState<Pending[]>(
    item?.attachments.map((a) => ({ key: a.fileId, name: a.name, progress: 1, preview: isImage(a.mime) ? a.url : undefined, file: { ...a, id: a.fileId } })) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const wantsFiles = props.kind !== 'note';

  useEffect(() => {
    if (!item && wantsFiles) setTimeout(() => fileRef.current?.click(), 250);
  }, []);

  const addFiles = async (list: FileList | null) => {
    for (const f of Array.from(list ?? []).slice(0, 10)) {
      const key = `${Date.now()}_${Math.random()}`;
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      setFiles((cur) => [...cur, { key, name: f.name, preview, progress: 0 }]);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
      try {
        const prepared = f.type.startsWith('image/') ? await preparePhoto(f) : { blob: f, name: f.name };
        const saved = await upload(home.id, prepared.blob, prepared.name, (p) =>
          setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        );
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, progress: 1, file: saved } : x)));
      } catch (err) {
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, error: errorText(err) } : x)));
      }
    }
  };

  const commitTag = () => {
    const t = tagDraft.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  };

  const uploading = files.some((f) => !f.file && !f.error);
  const save = async (e: Event) => {
    e.preventDefault();
    const allTags = tagDraft.trim() ? [...tags, tagDraft.trim().replace(/^#/, '')] : tags;
    const attachmentIds = files.filter((f) => f.file).map((f) => f.file!.id);
    if (!title.trim() && !attachmentIds.length) return setError('Hãy nhập tiêu đề.');
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { title, body, tags: allTags, attachmentIds };
      if (!item || item.canChangePrivacy) payload.private = isPrivate;
      const saved = item
        ? await api<Item>('PATCH', `/api/households/${home.id}/items/${item.id}`, payload)
        : await api<Item>('POST', `/api/households/${home.id}/items`, { ...payload, kind: props.kind });
      toast(item ? 'Đã lưu' : 'Đã thêm vào thư viện');
      props.onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title={item ? 'Sửa' : `Thêm ${KIND[props.kind].label.toLowerCase()}`} onClose={props.onClose}>
      <form onSubmit={save}>
        <label class="field">
          <span>Tiêu đề</span>
          <input class="input" name="title" value={title} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={200} placeholder={props.kind === 'note' ? 'VD: Mật khẩu Wi-Fi' : 'VD: Hợp đồng thuê nhà'} />
        </label>
        {(wantsFiles || files.length > 0) && (
          <div class="field">
            <span>Tệp đính kèm</span>
            <div class="attach-grid">
              {files.map((f) => (
                <div class="thumb" key={f.key}>
                  {f.preview ? <img src={f.preview} alt="" /> : <span>📄 {f.name}</span>}
                  {!f.file && !f.error && (
                    <span style={{ position: 'absolute', inset: 'auto 6px 6px', zIndex: 1 }}>
                      <span class="progress" style={{ margin: 0 }}>
                        <div style={{ width: `${Math.round(f.progress * 100)}%` }} />
                      </span>
                    </span>
                  )}
                  {f.error && <span style={{ position: 'relative', color: 'var(--danger)', background: 'var(--surface)', borderRadius: 8, padding: 4 }}>{f.error}</span>}
                  <button type="button" class="x" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" class="thumb" style={{ border: '2px dashed var(--line)', cursor: 'pointer', background: 'transparent' }} onClick={() => fileRef.current?.click()}>
                ＋ Thêm tệp
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept={props.kind === 'photo' ? 'image/*' : 'image/*,application/pdf'}
              onChange={(e) => {
                void addFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
            <p class="hint">Ảnh được thu nhỏ và xoá thông tin vị trí. PDF tối đa 10 MB.</p>
          </div>
        )}
        <label class="field">
          <span>{props.kind === 'note' ? 'Nội dung' : 'Ghi chú (không bắt buộc)'}</span>
          <textarea class="input" name="body" value={body} onInput={(e) => setBody(e.currentTarget.value)} maxLength={20000} rows={props.kind === 'note' ? 6 : 3} />
        </label>
        <div class="field">
          <span>Nhãn</span>
          <div class="input tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
            {tags.map((t) => (
              <span class="tag" key={t}>
                #{t}
                <button type="button" aria-label={`Bỏ nhãn ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder={tags.length ? '' : 'VD: nhà, giấy tờ (Enter để thêm)'}
              aria-label="Thêm nhãn"
              onInput={(e) => {
                const v = e.currentTarget.value;
                if (v.endsWith(',')) {
                  setTagDraft(v.slice(0, -1));
                  setTimeout(commitTag);
                } else setTagDraft(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTag();
                } else if (e.key === 'Backspace' && !tagDraft && tags.length) setTags(tags.slice(0, -1));
              }}
              onBlur={commitTag}
            />
          </div>
        </div>
        {(!item || item.canChangePrivacy) && (
          <Switch checked={isPrivate} onChange={setPrivate} label="🔒 Chỉ mình tôi thấy" hint="Người khác trong nhà sẽ không thấy món này." />
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy || uploading} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : uploading ? 'Đang tải tệp lên…' : 'Lưu'}
        </button>
      </form>
    </Sheet>
  );
}
