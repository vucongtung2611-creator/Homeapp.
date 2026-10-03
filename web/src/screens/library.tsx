import { useEffect, useRef, useState } from 'preact/hooks';
import { api, COLLECTIONS, RENTAL_DOCS, upload, type Collection, type Household, type Item, type UploadedFile } from '../api.js';
import { isImage, preparePhoto } from '../image.js';
import type { Live } from '../router.js';
import { EmptyState, ErrorState, Icon, Lightbox, Sheet, Skeleton, Spinner, Switch, toast, toastError, useLoad } from '../ui.js';
import { formatDate, formatMoney, formatNumber, t, type MessageKey } from '../i18n/index.js';
import { Illustration, RoomArt } from '../illustrations.js';
import { errorText, todayIso } from '../util.js';
import { getLocale } from '../i18n/index.js';
import { navigate, type Session } from '../router.js';

type Kind = Item['kind'];
const KIND_EMOJI: Record<Kind, string> = { note: '📝', photo: '🖼️', document: '📄', link: '🔗' };
const SHELF_EMOJI: Record<Collection, string> = { recipes: '🍲', wishlist: '🎁', shopping: '🛒', contacts: '📇', house_rules: '📜', rental: '🏠' };
const shelf = (c: Collection) => ({ emoji: SHELF_EMOJI[c], label: t(`library.collections.${c}` as MessageKey) });
/** A new item on a shelf starts from a small template, so it's quick to fill in. */
const template = (c?: Collection | null) => (c && c !== 'rental' ? t(`library.templates.${c}` as MessageKey) : '');
const daysUntil = (iso: string) => Math.round((Date.parse(iso) - Date.parse(todayIso())) / 86_400_000);

const KIND = new Proxy({} as Record<Kind, { label: string; emoji: string }>, {
  get: (_, k: string) => ({ label: t(`library.kinds.${k}` as MessageKey), emoji: KIND_EMOJI[k as Kind] }),
});

const MODE_KEY = 'homeapp:library-mode';
const VIS_EMOJI = { me: '🔒', home: '👥', managers: '🛡️' } as const;
/** "Who sees this", as a small label. */
function Visibility({ item, personal }: { item: Item; personal?: boolean }) {
  const v = personal ? 'me' : item.visibility;
  return (
    <span class={`badge vis-${v}`} title={t(`library.visibility.${v}` as MessageKey)}>
      {VIS_EMOJI[v]} {t(`library.visibility.${v}` as MessageKey)}
    </span>
  );
}

/**
 * The Library tab: a switch between Personal (your own private space, the
 * same in every home) and Home (this home's shared library, with shelves).
 */
export function LibraryTab({ home, live, session }: { home: Household; live: Live; session: Session }) {
  const [mode, setMode] = useState<'me' | 'home'>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'me' ? 'me' : 'home';
    } catch {
      return 'home';
    }
  });
  const choose = (m: 'me' | 'home') => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  const personal = useLoad(
    () => (mode === 'me' ? api<{ id: string }>('GET', '/api/me/personal').then((r) => api<Household>('GET', `/api/households/${r.id}`)) : Promise.resolve(undefined)),
    [mode, session.user?.id],
  );
  return (
    <>
      <div class="page library-top">
        <div class="segmented library-mode" role="group" aria-label={t('library.modeLabel')} data-testid="library-mode">
          <button type="button" aria-pressed={mode === 'me'} onClick={() => choose('me')}>
            🔒 {t('library.modeMe')}
          </button>
          <button type="button" aria-pressed={mode === 'home'} onClick={() => choose('home')}>
            🏠 {t('library.modeHome')}
          </button>
        </div>
        {mode === 'home' && session.households.length > 1 && (
          <select
            class="input"
            aria-label={t('library.whichHome')}
            value={home.id}
            onChange={(e) => navigate(`/h/${e.currentTarget.value}/library`)}
            data-testid="library-home"
          >
            {session.households.map((h) => (
              <option key={h.id} value={h.id}>
                🏠 {h.name}
              </option>
            ))}
          </select>
        )}
        <p class="hint" style={{ margin: '6px 2px 0' }}>
          {mode === 'me' ? t('library.modeMeHint') : t('library.modeHomeHint', { home: home.name })}
        </p>
      </div>
      {mode === 'home' ? (
        <LibraryScreen key={home.id} home={home} live={live} />
      ) : personal.data ? (
        <LibraryScreen key={personal.data.id} home={personal.data} live={live} personal />
      ) : personal.error ? (
        <ErrorState error={personal.error} onRetry={() => personal.reload()} />
      ) : (
        <div class="page">
          <Skeleton />
        </div>
      )}
    </>
  );
}

export function LibraryScreen({ home, live, personal = false }: { home: Household; live: Live; personal?: boolean }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>();
  const [kind, setKind] = useState<Kind>();
  const [collection, setCollection] = useState<Collection>();
  const [open, setOpen] = useState<Item>();
  const [editing, setEditing] = useState<{ item?: Item; kind: Kind; collection?: Collection } | undefined>();
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (tag) params.set('tag', tag);
  if (kind) params.set('kind', kind);
  if (collection) params.set('collection', collection);
  params.set('today', todayIso());
  const data = useLoad(
    () =>
      api<{ items: Item[]; tags: { tag: string; count: number }[]; collections: Record<Collection, number>; expiring: Item[] }>(
        'GET',
        `/api/households/${home.id}/items?${params}`,
      ),
    [home.id, query, tag, kind, collection],
  );
  useEffect(
    () => live.on((e) => (e.type === 'changed' && e.area === 'library') || e.type === 'resync' ? void data.reload(true) : undefined),
    [live, query, tag, kind, collection],
  );
  const canAdd = home.me.role !== 'guest';
  const addTo = (c: Collection) => setEditing({ kind: c === 'rental' ? 'document' : 'note', collection: c });

  // Keep an open item fresh after edits elsewhere.
  useEffect(() => {
    if (open && data.data) {
      const fresh = data.data.items.find((i) => i.id === open.id);
      if (fresh && fresh.updatedAt !== open.updatedAt) setOpen(fresh);
    }
  }, [data.data]);

  const filtered = Boolean(query || tag || kind || collection);
  const clearFilters = () => (setKind(undefined), setTag(undefined), setCollection(undefined), setQ(''));
  const items = data.data?.items ?? [];

  return (
    <div class="page">
      <div class="search">
        <Icon.search />
        <input
          class="input"
          type="search"
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('library.searchLabel')}
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      {!personal && !query && !collection && data.data && (
        <div class="shelves" role="group" aria-label={t('library.collectionsLabel')} data-testid="shelves">
          {COLLECTIONS.map((c) => (
            <button class="shelf" key={c} onClick={() => setCollection(c)}>
              <span class="emoji">{shelf(c).emoji}</span>
              <span class="name">{shelf(c).label}</span>
              <span class="count">{data.data!.collections[c] ? formatNumber(data.data!.collections[c]) : t('library.shelfEmpty')}</span>
            </button>
          ))}
        </div>
      )}
      {!personal && !filtered && (data.data?.expiring.length ?? 0) > 0 && (
        <div class="banner" role="status" data-testid="expiring">
          <span>
            ⏰ {t('library.expiringTitle', { count: data.data!.expiring.length })}{' '}
            {data.data!.expiring.slice(0, 3).map((i, n) => (
              <button key={i.id} class="link-btn" onClick={() => setOpen(i)}>
                {n > 0 && ', '}
                {i.title} ({expiryText(i.expiresOn!)})
              </button>
            ))}
          </span>
        </div>
      )}
      <div class="chips" role="group" aria-label={t('library.filters')}>
        {collection && (
          <button class="chip" aria-pressed="true" onClick={() => setCollection(undefined)} aria-label={t('library.clearCollection', { name: shelf(collection).label })}>
            {shelf(collection).emoji} {shelf(collection).label} ✕
          </button>
        )}
        <button class="chip" aria-pressed={!kind && !tag && !collection} onClick={clearFilters}>
          {t('library.all')}
        </button>
        {(['note', 'photo', 'document'] as Kind[]).map((k) => (
          <button class="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)} key={k}>
            {KIND[k].emoji} {KIND[k].label}
          </button>
        ))}
        {data.data?.tags.map((entry) => (
          <button class="chip" aria-pressed={tag === entry.tag} onClick={() => setTag(tag === entry.tag ? undefined : entry.tag)} key={entry.tag}>
            #{entry.tag}
          </button>
        ))}
      </div>

      {data.loading && !data.data ? (
        <Skeleton />
      ) : data.error && !data.data ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : items.length === 0 ? (
        collection && !query && !tag && !kind ? (
          <EmptyState
            art={<span class="big-emoji">{shelf(collection).emoji}</span>}
            title={t(`library.shelfEmptyTitle.${collection}` as MessageKey)}
            text={t(`library.shelfEmptyText.${collection}` as MessageKey)}
            action={
              canAdd && (
                <div class="row" style={{ justifyContent: 'center' }}>
                  <button class="btn" onClick={() => addTo(collection)}>
                    {t('library.addToShelf', { name: shelf(collection).label })}
                  </button>
                  <button
                    class="btn secondary"
                    data-testid="add-examples"
                    onClick={() =>
                      api('POST', `/api/households/${home.id}/samples`, { collection, locale: getLocale() })
                        .then(() => (toast(t('library.examplesAdded')), data.reload(true)))
                        .catch(toastError)
                    }
                  >
                    {t('library.addExamples')}
                  </button>
                </div>
              )
            }
          />
        ) : filtered ? (
          <EmptyState
            art={<Illustration.search />}
            title={t('library.noResultsTitle')}
            text={t('library.noResultsText')}
            action={
              <button class="btn secondary" onClick={clearFilters}>
                {t('library.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState
            art={<RoomArt room="library" fallback="library" />}
            title={t('library.emptyTitle')}
            text={t('library.emptyText')}
            action={
              canAdd && (
                <button class="btn" onClick={() => setChoosing(true)}>
                  {t('library.addFirst')}
                </button>
              )
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
                    {item.title}
                  </span>
                  <span class="meta">
                    {item.body ? item.body.split('\n')[0] : item.attachments.length ? t('library.files', { count: item.attachments.length }) : KIND[item.kind].label}
                  </span>
                  <span style={{ display: 'block', marginTop: 6 }}>
                    <Visibility item={item} personal={personal} />{' '}
                    {item.sample && <span class="badge">{t('common.sample')}</span>}
                  </span>
                  {(item.collection || item.expiresOn) && (
                    <span style={{ display: 'block', marginTop: 6 }}>
                      {item.collection && (
                        <span class="badge">
                          {shelf(item.collection).emoji} {item.docType ? t(`library.docTypes.${item.docType}` as MessageKey) : shelf(item.collection).label}
                        </span>
                      )}{' '}
                      {item.expiresOn && <ExpiryBadge iso={item.expiresOn} />}
                    </span>
                  )}
                  {item.tags.length > 0 && (
                    <span style={{ display: 'block', marginTop: 6 }}>
                      {item.tags.slice(0, 3).map((tag) => (
                        <span class="tag" key={tag}>
                          #{tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
      <button class="fab" onClick={() => (collection ? addTo(collection) : setChoosing(true))} data-testid="library-add">
        <Icon.plus /> {t('common.add')}
      </button>
      )}

      {choosing && (
        <Sheet title={t('library.addTitle')} onClose={() => setChoosing(false)}>
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
                  <small>{t(`library.kindHints.${k}` as MessageKey)}</small>
                </span>
              </button>
            ))}
          </div>
          {!personal && <h3 class="subhead">{t('library.orShelf')}</h3>}
          {!personal && <div class="shelf-grid">
            {COLLECTIONS.map((c) => (
              <button
                class="shelf"
                key={c}
                onClick={() => {
                  setChoosing(false);
                  addTo(c);
                }}
              >
                <span class="emoji">{shelf(c).emoji}</span>
                <span class="name">{shelf(c).label}</span>
              </button>
            ))}
          </div>}
        </Sheet>
      )}
      {open && !editing && (
        <ItemSheet
          item={open}
          onClose={() => setOpen(undefined)}
          onEdit={() => setEditing({ item: open, kind: open.kind, collection: open.collection ?? undefined })}
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
          collection={editing.collection}
          personal={personal}
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
    if (!confirm(t('library.deleteConfirm', { title: item.title }))) return;
    setBusy(true);
    try {
      await api('DELETE', `/api/households/${home.id}/items/${item.id}`);
      toast(t('library.deleted'));
      props.onDeleted();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };
  return (
    <Sheet title={item.title} onClose={props.onClose}>
      <p class="muted" style={{ marginTop: -8 }}>
        {t('library.meta', { kind: KIND[item.kind].label, owner: item.ownerName, date: formatDate(item.updatedAt, 'medium') })}
        {' · '}
        <Visibility item={item} />
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
            <span class="muted">{t('library.size', { size: formatNumber(Math.max(1, Math.round(a.size / 1024))) })}</span>
          </a>
        ))}
      {(item.collection || item.date || item.expiresOn) && (
        <dl class="details">
          {item.collection && (
            <>
              <dt>{t('library.shelf')}</dt>
              <dd>
                {shelf(item.collection).emoji} {shelf(item.collection).label}
                {item.docType && ` · ${t(`library.docTypes.${item.docType}` as MessageKey)}`}
              </dd>
            </>
          )}
          {item.date && (
            <>
              <dt>{t('library.date')}</dt>
              <dd>{formatDate(item.date, 'medium')}</dd>
            </>
          )}
          {item.expiresOn && (
            <>
              <dt>{t('library.expiresOn')}</dt>
              <dd>
                {formatDate(item.expiresOn, 'medium')} <ExpiryBadge iso={item.expiresOn} />
              </dd>
            </>
          )}
          {item.amount !== null && (
            <>
              <dt>{t('library.amount')}</dt>
              <dd>{formatMoney(item.amount, home.currency)}</dd>
            </>
          )}
        </dl>
      )}
      {item.body && <div class="card note-body">{item.body}</div>}
      {item.tags.length > 0 && (
        <p>
          {item.tags.map((tag) => (
            <span class="tag" key={tag}>
              #{tag}
            </span>
          ))}
        </p>
      )}
      <div class="row" style={{ marginTop: 16 }}>
        {item.canEdit && (
          <button class="btn secondary" onClick={props.onEdit}>
            {t('common.edit')}
          </button>
        )}
        {item.canDelete && (
          <button class="btn danger" onClick={remove} disabled={busy}>
            {t('common.delete')}
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

function EditorSheet(props: { home: Household; item?: Item; kind: Kind; collection?: Collection; personal?: boolean; onClose: () => void; onSaved: (item: Item) => void }) {
  const { home, item } = props;
  const [title, setTitle] = useState(item?.title ?? '');
  const [collection, setCollection] = useState<Collection | ''>(item?.collection ?? props.collection ?? '');
  const [body, setBody] = useState(item?.body ?? template(props.collection));
  const [docType, setDocType] = useState(item?.docType ?? 'lease');
  const [date, setDate] = useState(item?.date ?? '');
  const [expiresOn, setExpiresOn] = useState(item?.expiresOn ?? '');
  const [amountText, setAmountText] = useState(item?.amount != null ? String(item.amount) : '');
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [visibility, setVisibility] = useState<Item['visibility']>(item?.visibility ?? 'home');
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
    if (!title.trim() && !attachmentIds.length) return setError(t('library.titleRequired'));
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title,
        body,
        tags: allTags,
        attachmentIds,
        collection: collection || null,
        date: date || null,
        expiresOn: expiresOn || null,
      };
      if (collection === 'rental') {
        payload.docType = docType;
        payload.amount = amountText.trim() ? Number(amountText.replace(/[^\d.]/g, '')) : null;
      }
      if (!props.personal && (!item || item.canChangePrivacy)) payload.visibility = visibility;
      const saved = item
        ? await api<Item>('PATCH', `/api/households/${home.id}/items/${item.id}`, payload)
        : await api<Item>('POST', `/api/households/${home.id}/items`, { ...payload, kind: props.kind });
      toast(item ? t('library.saved') : t('library.added'));
      props.onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title={item ? t('library.editTitle') : t(`library.addKind.${props.kind}` as MessageKey)} onClose={props.onClose}>
      <form onSubmit={save}>
        <label class="field">
          <span>{t('library.title')}</span>
          <input class="input" name="title" value={title} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={200} placeholder={props.kind === 'note' ? t('library.titlePlaceholderNote') : t('library.titlePlaceholderOther')} />
        </label>
        {(wantsFiles || files.length > 0) && (
          <div class="field">
            <span>{t('library.attachments')}</span>
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
                  <button type="button" class="x" aria-label={t('library.removeFile', { name: f.name })} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" class="thumb" style={{ border: '2px dashed var(--line)', cursor: 'pointer', background: 'transparent' }} onClick={() => fileRef.current?.click()}>
                ＋ {t('library.addFile')}
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
            <p class="hint">{t('library.fileHint')}</p>
          </div>
        )}
        {!props.personal && <label class="field">
          <span>{t('library.shelf')}</span>
          <select
            class="input"
            name="collection"
            value={collection}
            onChange={(e) => {
              const next = e.currentTarget.value as Collection | '';
              // Swap in the new shelf's template only while the text is still the untouched template.
              if (!item && (body === '' || body === template(collection || null))) setBody(template(next || null));
              setCollection(next);
            }}
          >
            <option value="">{t('library.noShelf')}</option>
            {COLLECTIONS.map((c) => (
              <option key={c} value={c}>
                {shelf(c).emoji} {shelf(c).label}
              </option>
            ))}
          </select>
        </label>}
        {collection === 'rental' && (
          <div class="grid2">
            <label class="field">
              <span>{t('library.docType')}</span>
              <select class="input" name="docType" value={docType} onChange={(e) => setDocType(e.currentTarget.value as Item['docType'] & string)}>
                {RENTAL_DOCS.map((d) => (
                  <option key={d} value={d}>
                    {t(`library.docTypes.${d}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{t('library.amountOptional', { currency: home.currency })}</span>
              <input class="input" name="amount" inputMode="decimal" value={amountText} onInput={(e) => setAmountText(e.currentTarget.value)} />
            </label>
          </div>
        )}
        {collection === 'rental' && (
          <div class="grid2">
            <label class="field">
              <span>{t('library.date')}</span>
              <input class="input" type="date" name="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>{t('library.expiresOn')}</span>
              <input class="input" type="date" name="expiresOn" value={expiresOn} onInput={(e) => setExpiresOn(e.currentTarget.value)} />
              <p class="hint">{t('library.expiresHint')}</p>
            </label>
          </div>
        )}
        <label class="field">
          <span>{props.kind === 'note' ? t('library.body') : t('library.bodyOptional')}</span>
          <textarea class="input" name="body" value={body} onInput={(e) => setBody(e.currentTarget.value)} maxLength={20000} rows={props.kind === 'note' ? 6 : 3} />
        </label>
        <div class="field">
          <span>{t('library.tags')}</span>
          <div class="input tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
            {tags.map((tag) => (
              <span class="tag" key={tag}>
                #{tag}
                <button type="button" aria-label={t('library.removeTag', { tag })} onClick={() => setTags(tags.filter((x) => x !== tag))}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder={tags.length ? '' : t('library.tagsPlaceholder')}
              aria-label={t('library.addTag')}
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
        {!props.personal && (!item || item.canChangePrivacy) && (
          <label class="field">
            <span>{t('library.whoSees')}</span>
            <select class="input" name="visibility" value={visibility} onChange={(e) => setVisibility(e.currentTarget.value as Item['visibility'])}>
              {(['me', 'home', 'managers'] as const).map((v) => (
                <option key={v} value={v}>
                  {VIS_EMOJI[v]} {t(`library.visibility.${v}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy || uploading} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : uploading ? t('common.uploading') : t('common.save')}
        </button>
      </form>
    </Sheet>
  );
}

function expiryText(iso: string): string {
  const d = daysUntil(iso);
  return d < 0 ? t('library.expiredAgo', { count: -d }) : d === 0 ? t('library.expiresToday') : t('library.expiresIn', { count: d });
}

function ExpiryBadge({ iso }: { iso: string }) {
  const d = daysUntil(iso);
  return <span class={`badge ${d < 0 ? 'danger' : d <= 30 ? 'warn' : ''}`}>⏰ {d <= 30 ? expiryText(iso) : formatDate(iso, 'short')}</span>;
}
