import { useEffect, useState } from 'preact/hooks';
import { api, type Chore, type Household } from '../api.js';
import type { Live } from '../router.js';
import { daysUntil, formatDate, t, type MessageKey } from '../i18n/index.js';
import { EmptyState, ErrorState, Icon, Sheet, Skeleton, Spinner, toast, toastError, useLoad } from '../ui.js';
import { errorText, todayIso } from '../util.js';

const REPEATS = [1, 2, 3, 7, 14, 30, 90, 180, 365] as const;
const every = (n: number) => t(`chores.every.d${n}` as MessageKey);

/** Ready-made chores, including the reminder to change the Wi‑Fi password now and then. */
const IDEAS = [
  { key: 'ideaBins', title: 'titleBins', repeatDays: 7, turns: true },
  { key: 'ideaBathroom', title: 'titleBathroom', repeatDays: 7, turns: true },
  { key: 'ideaWifi', title: 'titleWifi', repeatDays: 90, turns: false },
] as const;

function DueBadge({ due }: { due: string }) {
  const d = daysUntil(due);
  if (d < 0) return <span class="badge danger">⏰ {t('chores.overdue')}</span>;
  if (d === 0) return <span class="badge warn">⏰ {t('chores.today')}</span>;
  return <span class="badge">📅 {formatDate(due)}</span>;
}

/** The home's to-do list: chores that come back, with people taking turns. */
export function ChoresView({ home, live }: { home: Household; live: Live }) {
  const data = useLoad(() => api<{ chores: Chore[]; canAdd: boolean }>('GET', `/api/households/${home.id}/chores`), [home.id]);
  const [editing, setEditing] = useState<{ chore?: Chore }>();
  const [busy, setBusy] = useState<string>();
  useEffect(
    () =>
      live.on((e) => {
        if ((e.type === 'changed' && e.area === 'chores') || e.type === 'resync') void data.reload(true);
      }),
    [live],
  );
  const residents = home.members.filter((m) => m.role !== 'guest');
  const canAdd = data.data?.canAdd ?? home.me.role !== 'guest';

  const tick = async (c: Chore, undo = false) => {
    setBusy(c.id);
    try {
      const next = await api<Chore>('POST', `/api/households/${home.id}/chores/${c.id}/done`, { today: todayIso(), ...(undo ? { undo: true } : {}) });
      toast(undo ? t('chores.saved') : next.repeatDays && next.currentName && next.assignees.length > 1 ? t('chores.passedTo', { name: next.currentName }) : t('chores.doneToast'));
      void data.reload(true);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(undefined);
    }
  };
  const addIdea = async (idea: (typeof IDEAS)[number]) => {
    try {
      await api('POST', `/api/households/${home.id}/chores`, {
        title: t(`chores.${idea.title}`),
        repeatDays: idea.repeatDays,
        assignees: idea.turns ? residents.map((m) => m.id) : [],
        today: todayIso(),
      });
      toast(t('chores.added'));
      void data.reload(true);
    } catch (err) {
      toastError(err);
    }
  };

  const chores = data.data?.chores ?? [];
  const ideas = IDEAS.filter((i) => !chores.some((c) => c.title === t(`chores.${i.title}`)));
  return (
    <div data-testid="chores">
      {data.error && !data.data ? (
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      ) : !data.data ? (
        <Skeleton />
      ) : chores.length === 0 ? (
        <EmptyState art={<span class="big-emoji">🧹</span>} title={t('chores.emptyTitle')} text={t('chores.emptyText')} />
      ) : (
        <ul class="list">
          {chores.map((c) => (
            <li key={c.id} class={`chore ${c.done ? 'done' : ''}`}>
              {canAdd && (
                <button
                  class={`tick ${c.done ? 'on' : ''}`}
                  aria-label={c.done ? t('chores.reopen') : t('chores.markDone', { title: c.title })}
                  disabled={busy === c.id}
                  onClick={() => tick(c, c.done)}
                >
                  {busy === c.id ? <Spinner /> : c.done ? <Icon.check /> : null}
                </button>
              )}
              <button class="list-item" onClick={() => c.canEdit && setEditing({ chore: c })} disabled={!c.canEdit}>
                <span class="grow">
                  <span class="title">{c.title}</span>
                  <span class="meta badges">
                    {!c.done && (
                      <span class={`badge ${c.current === home.me.id ? 'accent' : ''}`}>
                        👤 {c.current === home.me.id ? t('chores.yourTurn') : c.currentName ? t('chores.turnOf', { name: c.currentName }) : t('chores.anyone')}
                      </span>
                    )}
                    {c.repeatDays && <span class="badge">🔁 {every(c.repeatDays)}</span>}
                    {!c.done && c.due && <DueBadge due={c.due} />}
                    {c.done && <span class="badge">✅ {t('chores.done')}</span>}
                  </span>
                  {c.lastDoneBy && <span class="meta">{t('chores.lastDone', { name: c.lastDoneBy })}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAdd && ideas.length > 0 && data.data && (
        <>
          <h3 class="section-title">{t('chores.ideas')}</h3>
          <div class="chips wrap">
            {ideas.map((i) => (
              <button class="chip" key={i.key} onClick={() => addIdea(i)} data-testid={`idea-${i.key}`}>
                {t(`chores.${i.key}`)}
              </button>
            ))}
          </div>
        </>
      )}
      {canAdd && (
        <button class="fab" onClick={() => setEditing({})} data-testid="chore-add">
          <Icon.plus /> {t('common.add')}
        </button>
      )}
      {editing && (
        <ChoreSheet
          home={home}
          chore={editing.chore}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void data.reload(true);
          }}
        />
      )}
    </div>
  );
}

function ChoreSheet(props: { home: Household; chore?: Chore; onClose: () => void; onSaved: () => void }) {
  const { home, chore } = props;
  const [title, setTitle] = useState(chore?.title ?? '');
  const [turns, setTurns] = useState<string[]>(chore?.assignees ?? []);
  const [repeat, setRepeat] = useState<string>(chore?.repeatDays ? String(chore.repeatDays) : '');
  const [due, setDue] = useState(chore?.due ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return setError(t('errors.field_required'));
    setBusy(true);
    try {
      const payload = { title, assignees: turns, repeatDays: repeat ? Number(repeat) : null, due: due || null, today: todayIso() };
      if (chore) await api('PATCH', `/api/households/${home.id}/chores/${chore.id}`, payload);
      else await api('POST', `/api/households/${home.id}/chores`, payload);
      toast(chore ? t('chores.saved') : t('chores.added'));
      props.onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!chore || !confirm(t('chores.deleteConfirm'))) return;
    try {
      await api('DELETE', `/api/households/${home.id}/chores/${chore.id}`);
      toast(t('chores.deleted'));
      props.onSaved();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Sheet title={chore ? t('chores.editTitle') : t('chores.newTitle')} onClose={props.onClose}>
      <form onSubmit={save} data-testid="chore-editor">
        <label class="field">
          <span>{t('chores.title')}</span>
          <input class="input" name="title" value={title} maxLength={200} placeholder={t('chores.titlePlaceholder')} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <div class="field">
          <span>{t('chores.turns')}</span>
          <div class="chips wrap" role="group" aria-label={t('chores.turns')}>
            {home.members
              .filter((m) => m.role !== 'guest')
              .map((m) => {
                const n = turns.indexOf(m.id);
                return (
                  <button type="button" class="chip" key={m.id} aria-pressed={n >= 0} onClick={() => setTurns(n >= 0 ? turns.filter((x) => x !== m.id) : [...turns, m.id])}>
                    {n >= 0 ? `${n + 1}. ` : ''}
                    {m.name}
                  </button>
                );
              })}
          </div>
          <p class="hint">{t('chores.turnsHint')}</p>
        </div>
        <div class="grid2">
          <label class="field">
            <span>{t('chores.repeat')}</span>
            <select class="input" name="repeat" value={repeat} onChange={(e) => setRepeat(e.currentTarget.value)}>
              <option value="">{t('chores.once')}</option>
              {REPEATS.map((n) => (
                <option key={n} value={String(n)}>
                  {every(n)}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>{t('chores.due')}</span>
            <input class="input" type="date" name="due" value={due} onInput={(e) => setDue(e.currentTarget.value)} />
          </label>
        </div>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : t('common.save')}
        </button>
        {chore && (
          <button class="btn block ghost danger" type="button" onClick={remove} style={{ marginTop: 8 }}>
            {t('chores.delete')}
          </button>
        )}
      </form>
    </Sheet>
  );
}
