import { useEffect, useState } from 'preact/hooks';
import { api, type CalendarEvent, type Household } from '../api.js';
import type { Live } from '../router.js';
import { navigate } from '../router.js';
import { formatDate, getLocale, t, type MessageKey } from '../i18n/index.js';
import { EmptyState, ErrorState, Icon, Sheet, Skeleton, Spinner, toast, toastError, useLoad } from '../ui.js';
import { errorText, todayIso } from '../util.js';

const VIEW_KEY = 'homeapp:calendar-view';
const VIS_EMOJI = { me: '🔒', home: '👥', managers: '🛡️' } as const;
/** One soft color per person, in member order; the whole home is neutral. */
const PERSON_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#b07cc6', '#e9a23b', '#4aa3a2', '#d16b9b', '#7a8b99'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Weeks start on Monday. */
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

type Filter = 'all' | 'mine' | `person:${string}` | `tag:${string}`;

export function colorOf(home: Household, ev: CalendarEvent): string | undefined {
  const first = ev.people[0];
  if (!first) return undefined;
  const i = home.members.findIndex((m) => m.id === first);
  return i < 0 ? undefined : PERSON_COLORS[i % PERSON_COLORS.length];
}

export const timeText = (ev: Pick<CalendarEvent, 'time' | 'endTime'>) =>
  ev.time ? (ev.endTime ? `${ev.time}–${ev.endTime}` : ev.time) : t('calendar.allDay');

export function CalendarScreen({ home, live }: { home: Household; live: Live }) {
  const me = home.me.id;
  const [view, setView] = useState<'month' | 'week'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month';
    } catch {
      return 'month';
    }
  });
  const [anchor, setAnchor] = useState(() => parse(todayIso()));
  const [selected, setSelected] = useState(todayIso());
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ event?: CalendarEvent; draft?: Partial<CalendarEvent> }>();
  const [syncing, setSyncing] = useState(false);

  const first = view === 'month' ? startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : startOfWeek(anchor);
  const days = view === 'month' ? 42 : 7;
  const from = iso(first);
  const to = iso(addDays(first, days - 1));
  const data = useLoad(() => api<{ events: CalendarEvent[]; tags: string[]; canAdd: boolean }>('GET', `/api/households/${home.id}/calendar?from=${from}&to=${to}`), [home.id, from, to]);

  useEffect(
    () =>
      live.on((e) => {
        if ((e.type === 'changed' && e.area === 'calendar') || e.type === 'resync') void data.reload(true);
      }),
    [live, from, to],
  );

  // Opened from a chat message ("Add to home calendar"): start a new appointment from it.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('new') !== '1') return;
    const date = q.get('date') ?? todayIso();
    setAnchor(parse(date));
    setSelected(date);
    setEditing({ draft: { date, time: q.get('time') || null, title: q.get('title') ?? '' } });
    history.replaceState(null, '', location.pathname);
  }, []);

  const chooseView = (v: 'month' | 'week') => {
    setView(v);
    setAnchor(parse(selected));
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const step = (n: number) => {
    const next = view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : addDays(anchor, 7 * n);
    setAnchor(next);
    if (view === 'week') setSelected(iso(startOfWeek(next)));
  };
  const goToday = () => {
    setAnchor(parse(todayIso()));
    setSelected(todayIso());
  };

  const matches = (ev: CalendarEvent) =>
    filter === 'all'
      ? true
      : filter === 'mine'
        ? ev.people.includes(me) || (ev.createdBy === me && ev.people.length === 0)
        : filter.startsWith('person:')
          ? ev.people.includes(filter.slice(7))
          : ev.tag === filter.slice(4);
  const events = (data.data?.events ?? []).filter(matches);
  const on = (day: string) => events.filter((e) => e.date === day);
  const canAdd = data.data?.canAdd ?? home.me.role !== 'guest';
  const locale = getLocale();
  const heading =
    view === 'month'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)
      : `${formatDate(from)} – ${formatDate(to)}`;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(addDays(first, i)));
  const today = todayIso();
  const peopleWithEvents = home.members.filter((m) => (data.data?.events ?? []).some((e) => e.people.includes(m.id)));

  return (
    <div class="page calendar-page">
      <div class="segmented" role="group" aria-label={t('calendar.viewLabel')} data-testid="calendar-view">
        <button type="button" aria-pressed={view === 'month'} onClick={() => chooseView('month')}>
          {t('calendar.month')}
        </button>
        <button type="button" aria-pressed={view === 'week'} onClick={() => chooseView('week')}>
          {t('calendar.week')}
        </button>
      </div>
      <div class="cal-nav">
        <button class="icon-btn" aria-label={t('calendar.prev')} onClick={() => step(-1)}>
          <Icon.back />
        </button>
        <h2 data-testid="calendar-heading">{heading}</h2>
        <button class="icon-btn flip" aria-label={t('calendar.next')} onClick={() => step(1)}>
          <Icon.back />
        </button>
        <button class="btn small ghost" onClick={goToday}>
          {t('calendar.today')}
        </button>
      </div>
      <div class="chips" role="group" aria-label={t('calendar.filterLabel')} data-testid="calendar-filter">
        <button class="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          {t('calendar.all')}
        </button>
        <button class="chip" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
          {t('calendar.mine')}
        </button>
        {peopleWithEvents
          .filter((m) => m.id !== me)
          .map((m) => (
            <button class="chip" key={m.id} aria-pressed={filter === `person:${m.id}`} onClick={() => setFilter(`person:${m.id}`)}>
              <span class="cal-dot" style={{ background: PERSON_COLORS[home.members.indexOf(m) % PERSON_COLORS.length] }} /> {m.name}
            </button>
          ))}
        {data.data?.tags.map((tag) => (
          <button class="chip" key={tag} aria-pressed={filter === `tag:${tag}`} onClick={() => setFilter(`tag:${tag}`)}>
            🏷️ {tag}
          </button>
        ))}
      </div>

      {data.error && !data.data ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : !data.data ? (
        <Skeleton />
      ) : view === 'month' ? (
        <>
          <div class="cal-grid" role="grid" data-testid="calendar-month">
            {weekdays.map((w) => (
              <div class="cal-wd" key={w} role="columnheader">
                {w}
              </div>
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = addDays(first, i);
              const key = iso(d);
              const list = on(key);
              return (
                <button
                  key={key}
                  role="gridcell"
                  class={`cal-day ${d.getMonth() !== anchor.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}
                  aria-pressed={key === selected}
                  aria-label={`${formatDate(key, 'medium')}${list.length ? ` · ${list.map((e) => e.title).join(', ')}` : ''}`}
                  onClick={() => setSelected(key)}
                >
                  <span class="n">{d.getDate()}</span>
                  <span class="cal-marks">
                    {list.slice(0, 3).map((e) => (
                      <span key={e.id} class="cal-dot" style={{ background: colorOf(home, e) ?? 'var(--accent)' }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <DayList
            day={selected}
            events={on(selected)}
            home={home}
            canAdd={canAdd}
            onOpen={(event) => setEditing({ event })}
            onAdd={() => setEditing({ draft: { date: selected } })}
          />
        </>
      ) : (
        <div data-testid="calendar-week">
          {Array.from({ length: 7 }, (_, i) => iso(addDays(first, i))).map((day) => (
            <DayList key={day} day={day} events={on(day)} home={home} canAdd={canAdd} compact onOpen={(event) => setEditing({ event })} onAdd={() => setEditing({ draft: { date: day } })} />
          ))}
        </div>
      )}
      {data.data && data.data.events.length === 0 && view === 'month' && (
        <EmptyState art={<span class="big-emoji">📅</span>} title={t('calendar.emptyTitle')} text={canAdd ? t('calendar.emptyText') : t('calendar.guestNote')} />
      )}

      <button class="btn secondary block" style={{ marginTop: 8 }} onClick={() => setSyncing(true)} data-testid="calendar-sync">
        🔗 {t('calendarSync.open')}
      </button>
      {syncing && <SyncSheet home={home} onClose={() => setSyncing(false)} />}
      {canAdd && (
        <button class="fab" onClick={() => setEditing({ draft: { date: selected } })} data-testid="calendar-add">
          <Icon.plus /> {t('common.add')}
        </button>
      )}
      {editing && (
        <EventSheet
          home={home}
          event={editing.event}
          draft={editing.draft}
          tags={data.data?.tags ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={(ev) => {
            setEditing(undefined);
            setSelected(ev.date);
            setAnchor(parse(ev.date));
            void data.reload(true);
          }}
        />
      )}
    </div>
  );
}

function DayList(props: { day: string; events: CalendarEvent[]; home: Household; canAdd: boolean; compact?: boolean; onOpen: (e: CalendarEvent) => void; onAdd: () => void }) {
  const { day, events, home } = props;
  const isToday = day === todayIso();
  return (
    <section class={`cal-daylist ${props.compact ? 'compact' : ''}`} aria-label={formatDate(day, 'medium')}>
      <h3>
        {new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(parse(day))}
        {isToday && <span class="badge">{t('calendar.today')}</span>}
      </h3>
      {events.length === 0 ? (
        <p class="muted small">
          {t('calendar.emptyDay')}{' '}
          {props.canAdd && !props.compact && (
            <button class="link-btn" onClick={props.onAdd}>
              {t('calendar.addOn')}
            </button>
          )}
        </p>
      ) : (
        <ul class="list">
          {events.map((ev) => (
            <li key={ev.id}>
              <button class="list-item cal-event" onClick={() => props.onOpen(ev)} style={{ borderLeftColor: colorOf(home, ev) ?? 'var(--accent)' }}>
                <span class="cal-time">{timeText(ev)}</span>
                <span class="grow">
                  <span class="title">{ev.title}</span>
                  <span class="meta">
                    {ev.people.length ? ev.people.map((id) => home.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ') : t('calendar.wholeHome')}
                    {ev.tag ? ` · 🏷️ ${ev.tag}` : ''}
                    {ev.visibility !== 'home' ? ` · ${VIS_EMOJI[ev.visibility]}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventSheet(props: {
  home: Household;
  event?: CalendarEvent;
  draft?: Partial<CalendarEvent>;
  tags: string[];
  onClose: () => void;
  onSaved: (ev: CalendarEvent) => void;
}) {
  const { home, event } = props;
  const start = { ...props.draft, ...event };
  const readOnly = event ? !event.canEdit : false;
  const [title, setTitle] = useState(start.title ?? '');
  const [date, setDate] = useState(start.date ?? todayIso());
  const [time, setTime] = useState(start.time ?? '');
  const [endTime, setEndTime] = useState(start.endTime ?? '');
  const [people, setPeople] = useState<string[]>(start.people ?? []);
  const [tag, setTag] = useState(start.tag ?? '');
  const [note, setNote] = useState(start.note ?? '');
  const [visibility, setVisibility] = useState<CalendarEvent['visibility']>(start.visibility ?? 'home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mineToShare = !event || event.createdBy === home.me.id;

  const save = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return setError(t('errors.field_required'));
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { title, date, time: time || null, endTime: time && endTime ? endTime : null, people, tag: tag || null, note };
      if (mineToShare) payload.visibility = visibility;
      const saved = event
        ? await api<CalendarEvent>('PATCH', `/api/households/${home.id}/calendar/${event.id}`, payload)
        : await api<CalendarEvent>('POST', `/api/households/${home.id}/calendar`, payload);
      toast(event ? t('calendar.saved') : t('calendar.added'));
      props.onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!event || !confirm(t('calendar.deleteConfirm'))) return;
    try {
      await api('DELETE', `/api/households/${home.id}/calendar/${event.id}`);
      toast(t('calendar.deleted'));
      props.onSaved(event);
    } catch (err) {
      toastError(err);
    }
  };

  if (readOnly && event) {
    return (
      <Sheet title={event.title} onClose={props.onClose}>
        <p>
          📅 {formatDate(event.date, 'medium')} · {timeText(event)}
        </p>
        <p class="muted">
          {event.people.length ? event.people.map((id) => home.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ') : t('calendar.wholeHome')}
          {event.tag ? ` · 🏷️ ${event.tag}` : ''}
        </p>
        {event.note && <p style={{ whiteSpace: 'pre-wrap' }}>{event.note}</p>}
        <p class="hint">
          {t('calendar.addedBy', { name: event.createdByName })} · {t('calendar.readOnly')}
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet title={event ? t('calendar.editTitle') : t('calendar.newTitle')} onClose={props.onClose}>
      <form onSubmit={save} data-testid="calendar-editor">
        <label class="field">
          <span>{t('calendar.title')}</span>
          <input class="input" name="title" value={title} maxLength={200} placeholder={t('calendar.titlePlaceholder')} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{t('calendar.date')}</span>
          <input class="input" type="date" name="date" required value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </label>
        <div class="grid2">
          <label class="field">
            <span>{t('calendar.time')}</span>
            <input class="input" type="time" name="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>{t('calendar.endTime')}</span>
            <input class="input" type="time" name="endTime" value={endTime} disabled={!time} onInput={(e) => setEndTime(e.currentTarget.value)} />
          </label>
        </div>
        <div class="field">
          <span>{t('calendar.forWho')}</span>
          <div class="chips wrap" role="group" aria-label={t('calendar.forWho')}>
            {home.members.map((m, i) => (
              <button
                type="button"
                class="chip"
                key={m.id}
                aria-pressed={people.includes(m.id)}
                onClick={() => setPeople(people.includes(m.id) ? people.filter((x) => x !== m.id) : [...people, m.id])}
              >
                <span class="cal-dot" style={{ background: PERSON_COLORS[i % PERSON_COLORS.length] }} /> {m.name}
              </button>
            ))}
          </div>
          <p class="hint">{t('calendar.forWhoHint')}</p>
        </div>
        <label class="field">
          <span>{t('calendar.tag')}</span>
          <input class="input" name="tag" list="calendar-tags" value={tag} maxLength={40} onInput={(e) => setTag(e.currentTarget.value)} />
          <datalist id="calendar-tags">
            {props.tags.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <p class="hint">{t('calendar.tagHint')}</p>
        </label>
        <label class="field">
          <span>{t('calendar.note')}</span>
          <textarea class="input" name="note" rows={3} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        {mineToShare && (
          <label class="field">
            <span>{t('calendar.whoSees')}</span>
            <select class="input" name="visibility" value={visibility} onChange={(e) => setVisibility(e.currentTarget.value as CalendarEvent['visibility'])}>
              {(['home', 'managers', 'me'] as const).map((v) => (
                <option key={v} value={v}>
                  {VIS_EMOJI[v]} {t(`calendar.visibility.${v}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        )}
        {event && <p class="hint">{t('calendar.addedBy', { name: event.createdByName })}</p>}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : t('common.save')}
        </button>
        {event && (
          <button class="btn block ghost danger" type="button" onClick={remove} style={{ marginTop: 8 }}>
            {t('calendar.delete')}
          </button>
        )}
      </form>
    </Sheet>
  );
}

/**
 * Shown when the app opens: today's and tomorrow's appointments that concern
 * me (mine, or for the whole home). Hidden for the day once dismissed.
 */
export function CalendarReminder({ home }: { home: Household }) {
  const today = todayIso();
  const tomorrow = iso(addDays(parse(today), 1));
  const key = `homeapp:cal-seen:${home.id}:${today}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    if (hidden) return;
    api<{ events: CalendarEvent[] }>('GET', `/api/households/${home.id}/calendar?from=${today}&to=${tomorrow}`)
      .then((r) => setEvents(r.events.filter((e) => e.people.length === 0 || e.people.includes(home.me.id))))
      .catch(() => {});
  }, [home.id, hidden]);
  if (hidden || events.length === 0) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, '1');
    } catch {}
  };
  return (
    <div class="banner info cal-reminder" role="status" data-testid="calendar-reminder" style={{ margin: '0 20px 10px' }}>
      <span style={{ flex: 1 }}>
        <strong>⏰ {t('calendar.reminderTitle')}:</strong>{' '}
        {events.slice(0, 3).map((e, i) => (
          <button key={e.id} class="link-btn" onClick={() => navigate(`/h/${home.id}/calendar`)}>
            {i > 0 && '; '}
            {e.date === today ? t('calendar.reminderToday') : t('calendar.reminderTomorrow')} {e.time ?? ''} {e.title}
          </button>
        ))}
        {events.length > 3 && ` ${t('calendar.more', { count: events.length - 3 })}`}
      </span>
      <button class="link-btn" onClick={dismiss}>
        {t('calendar.dismiss')}
      </button>
    </div>
  );
}

/** The home calendar in Google, Apple or Outlook: a one-off .ics file, or a secret link they subscribe to. */
function SyncSheet({ home, onClose }: { home: Household; onClose: () => void }) {
  const status = useLoad(() => api<{ active: boolean; createdAt: string | null; lastUsedAt: string | null }>('GET', `/api/households/${home.id}/calendar-feed`), [home.id]);
  const [made, setMade] = useState<{ url: string; webcal: string }>();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      setMade(await api<{ url: string; webcal: string }>('POST', `/api/households/${home.id}/calendar-feed`));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const off = async () => {
    try {
      await api('DELETE', `/api/households/${home.id}/calendar-feed`);
      setMade(undefined);
      toast(t('calendarSync.offDone'));
      void status.reload(true);
    } catch (err) {
      toastError(err);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made!.url);
      toast(t('calendarSync.copied'));
    } catch {
      (document.querySelector('[data-testid=feed-url]') as HTMLInputElement | null)?.select();
    }
  };
  return (
    <Sheet title={t('calendarSync.title')} onClose={onClose}>
      <h3 class="section-title" style={{ marginTop: 4 }}>{t('calendarSync.fileTitle')}</h3>
      <p class="muted">{t('calendarSync.fileText')}</p>
      <a class="btn secondary block" href={`/api/households/${home.id}/calendar.ics`} download data-testid="ics-download">
        📥 {t('calendarSync.download')}
      </a>
      <h3 class="section-title">{t('calendarSync.feedTitle')}</h3>
      <p class="muted">{t('calendarSync.feedText')}</p>
      {made ? (
        <>
          <input class="input" readOnly value={made.url} data-testid="feed-url" onFocus={(e) => e.currentTarget.select()} />
          <p class="hint">⚠️ {t('calendarSync.showOnce')}</p>
          <button class="btn block" onClick={copy}>
            📋 {t('calendarSync.copy')}
          </button>
          <a class="btn secondary block" style={{ marginTop: 8 }} href={made.webcal}>
            🍎 {t('calendarSync.openApple')}
          </a>
          <ul class="hint" style={{ paddingLeft: 18 }}>
            <li>{t('calendarSync.google')}</li>
            <li>{t('calendarSync.apple')}</li>
          </ul>
        </>
      ) : status.data?.active ? (
        <>
          <p data-testid="feed-active">
            ✅ {t('calendarSync.activeSince', { date: formatDate(status.data.createdAt!.slice(0, 10)) })}{' '}
            {status.data.lastUsedAt && t('calendarSync.lastUsed', { date: formatDate(status.data.lastUsedAt.slice(0, 10)) })}
          </p>
          <p class="hint">{t('calendarSync.remakeHint')}</p>
          <button class="btn block" onClick={make} disabled={busy}>
            {busy ? <Spinner /> : t('calendarSync.remake')}
          </button>
        </>
      ) : (
        <button class="btn block" onClick={make} disabled={busy || status.loading} data-testid="feed-make">
          {busy ? <Spinner /> : t('calendarSync.make')}
        </button>
      )}
      {(made || status.data?.active) && (
        <button class="btn block ghost danger" style={{ marginTop: 8 }} onClick={off}>
          {t('calendarSync.off')}
        </button>
      )}
      <p class="hint" style={{ marginTop: 12 }}>
        ↔️ {t('calendarSync.oneWay')}
      </p>
    </Sheet>
  );
}
