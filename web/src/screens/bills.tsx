import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RuleBasedExtractor, parseAmount, type BillFact, type ReceiptFact } from '../../../src/integrations/understand.js';
import { currencyDigits, splitEvenly } from '../../../src/modules/finance.js';
import { api, type Bill, type Household, type Member, type Money } from '../api.js';
import { CharacterAvatar } from '../characters.js';
import { formatAmountInput, formatDate, formatList, formatMoney, t } from '../i18n/index.js';
import { RoomArt } from '../illustrations.js';
import { readTextFromImage } from '../ocr.js';
import type { Live } from '../router.js';
import { EmptyState, ErrorState, Icon, Sheet, Skeleton, Spinner, Switch, toast, toastError, useLoad } from '../ui.js';
import { CATEGORIES, CATEGORY_EMOJI, categoryLabel, dueText, errorText, todayIso } from '../util.js';

const RESIDENT = ['owner', 'tenant', 'family_member', 'child'];

export function BillsScreen({ home, live }: { home: Household; live: Live }) {
  const data = useLoad(() => api<Money>('GET', `/api/households/${home.id}/money`), [home.id]);
  const [adding, setAdding] = useState<'choose' | 'bill' | 'expense'>();
  const [openBill, setOpenBill] = useState<string>();
  useEffect(() => live.on((e) => ((e.type === 'changed' && e.area === 'bills') || e.type === 'resync' ? void data.reload(true) : undefined)), [live]);

  const m = data.data;
  const me = home.me.id;
  const member = (id: string) => m?.members.find((x) => x.id === id) ?? home.members.find((x) => x.id === id);
  const name = (id: string) => (id === me ? t('common.you') : (member(id)?.name ?? t('common.formerMember')));
  const residents = home.members.filter((x) => RESIDENT.includes(x.role));

  if (data.loading && !m)
    return (
      <div class="page">
        <div class="skeleton" style={{ height: 140, marginBottom: 12 }} />
        <Skeleton rows={3} />
      </div>
    );
  if (data.error && !m)
    return (
      <div class="page">
        <ErrorState error={data.error} onRetry={() => data.reload()} />
      </div>
    );
  if (!m) return null;

  const myBalance = m.balances[me] ?? 0;
  const bill = m.bills.find((b) => b.id === openBill);
  const unpaid = m.bills.filter((b) => b.status === 'unpaid');
  const paid = m.bills.filter((b) => b.status === 'paid');

  const settle = async (tr: { from: string; to: string; amount: number }) => {
    const amount = formatMoney(tr.amount, m.currency);
    const question = tr.from === me ? t('bills.confirmPaid', { amount, name: name(tr.to) }) : t('bills.confirmReceived', { amount, name: name(tr.from) });
    if (!confirm(question)) return;
    try {
      data.setData(await api<Money>('POST', `/api/households/${home.id}/settlements`, tr));
      toast(t('bills.recorded'));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div class="page">
      <section class={`card hero ${myBalance < 0 ? 'owe' : myBalance > 0 ? 'owed' : ''}`} aria-label={t('bills.balance')}>
        <div class="muted">{myBalance < 0 ? t('bills.youOwe') : myBalance > 0 ? t('bills.owedToYou') : t('bills.balance')}</div>
        <div class="big-number">{myBalance === 0 ? t('bills.allSquare') : formatMoney(Math.abs(myBalance), m.currency)}</div>
        <div class="muted" style={{ fontSize: 15 }}>
          {t('bills.unpaid', { count: unpaid.length })}
        </div>
      </section>

      {m.reminders
        .filter((r) => r.kind !== 'debt')
        .map((r) => (
          <button
            key={r.key}
            class={`banner ${r.kind === 'bill_overdue' ? 'error' : ''}`}
            style={{ width: '100%', border: 0, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => r.billId && setOpenBill(r.billId)}
          >
            <span aria-hidden="true">{r.kind === 'bill_overdue' ? '⏰' : '🔔'}</span>
            <span style={{ flex: 1 }}>{t('bills.reminder', { label: r.label, due: dueText(r.dueDate).text, amount: formatMoney(r.amount, m.currency) })}</span>
          </button>
        ))}

      <h2 class="section-title">{t('bills.whoOwes')}</h2>
      <section class="card">
        {m.transfers.length === 0 ? (
          <p class="muted" style={{ margin: 0 }}>
            {t('bills.nobodyOwes')}
          </p>
        ) : (
          m.transfers.map((tr) => (
            <div class="transfer" key={`${tr.from}-${tr.to}`}>
              <CharacterAvatar id={member(tr.from)?.avatar} size={36} />
              <div class="grow">
                <div>
                  <strong>{name(tr.from)}</strong> → <strong>{name(tr.to)}</strong>
                </div>
                <div class="amount">{formatMoney(tr.amount, m.currency)}</div>
              </div>
              {(tr.from === me || tr.to === me) && (
                <button class="btn small secondary" onClick={() => settle(tr)}>
                  {tr.from === me ? t('bills.paidButton') : t('bills.receivedButton')}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      <h2 class="section-title">{t('bills.title')}</h2>
      {m.bills.length === 0 ? (
        <EmptyState
          art={<RoomArt room="bills" fallback="bills" />}
          title={t('bills.emptyTitle')}
          text={t('bills.emptyText')}
          action={
            <button class="btn" onClick={() => setAdding('bill')}>
              {t('bills.addBill')}
            </button>
          }
        />
      ) : (
        <ul class="list">
          {[...unpaid, ...paid].map((b) => {
            const due = dueText(b.dueDate);
            const mine = b.shares[me];
            return (
              <li key={b.id}>
                <button class="list-item" onClick={() => setOpenBill(b.id)} style={b.status === 'paid' ? { opacity: 0.7 } : undefined}>
                  <span class="emoji">{CATEGORY_EMOJI[b.category] ?? '🧾'}</span>
                  <span class="grow">
                    <span class="title">{b.label}</span>
                    <span class="meta badges">
                      {b.status === 'paid' ? (
                        <span class="badge ok">{t('bills.paidBy', { name: name(b.payerId ?? '') })}</span>
                      ) : (
                        <span class={`badge ${due.tone}`}>{due.text}</span>
                      )}
                      {!b.shared && <span class="badge">🔒 {t('bills.personal')}</span>}
                      {b.sample && <span class="badge">{t('common.sample')}</span>}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span class="amount" style={{ display: 'block' }}>
                      {formatMoney(b.amount, b.currency)}
                    </span>
                    {mine !== undefined && b.shared && (
                      <span class="meta" style={{ fontSize: 13 }}>
                        {t('bills.yourShare', { amount: formatMoney(mine, b.currency) })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {m.expenses.length > 0 && (
        <>
          <h2 class="section-title">{t('bills.activity')}</h2>
          <ul class="list">
            {m.expenses.slice(0, 20).map((x) => (
              <li key={x.id} class="list-item" style={{ cursor: 'default' }}>
                <span class="emoji">{x.kind === 'settlement' ? '🤝' : x.shared ? '🛒' : '🔒'}</span>
                <span class="grow">
                  <span class="title">
                    {x.kind === 'settlement' ? t('bills.settlementLabel', { from: name(x.paidBy), to: name(x.participants[0] ?? '') }) : x.label}
                  </span>
                  <span class="meta">
                    {formatDate(x.date)} ·{' '}
                    {x.kind === 'settlement'
                      ? t('bills.payment')
                      : x.shared
                        ? t('bills.sharedBy', { name: name(x.paidBy), count: x.participants.length })
                        : t('bills.personalExpense')}
                  </span>
                </span>
                <span class="amount">{formatMoney(x.amount, m.currency)}</span>
                {x.canDelete && (
                  <button
                    class="icon-btn"
                    aria-label={t('bills.deleteItem')}
                    onClick={async () => {
                      if (!confirm(t('bills.deleteConfirm'))) return;
                      try {
                        data.setData(await api<Money>('DELETE', `/api/households/${home.id}/money/${x.id}`));
                      } catch (err) {
                        toastError(err);
                      }
                    }}
                  >
                    <Icon.close />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <button class="fab" onClick={() => setAdding('choose')}>
        <Icon.plus /> {t('common.add')}
      </button>

      {adding === 'choose' && (
        <Sheet title={t('bills.addTitle')} onClose={() => setAdding(undefined)}>
          <div class="choice-grid">
            <button class="choice" onClick={() => setAdding('bill')}>
              <span class="emoji">🧾</span>
              <span>
                <strong>{t('bills.billChoice')}</strong>
                <small>{t('bills.billChoiceHint')}</small>
              </span>
            </button>
            <button class="choice" onClick={() => setAdding('expense')}>
              <span class="emoji">🛒</span>
              <span>
                <strong>{t('bills.expenseChoice')}</strong>
                <small>{t('bills.expenseChoiceHint')}</small>
              </span>
            </button>
          </div>
        </Sheet>
      )}
      {adding === 'bill' && (
        <AddBillSheet
          home={home}
          residents={residents}
          onClose={() => setAdding(undefined)}
          onSaved={(next) => {
            data.setData(next);
            setAdding(undefined);
            toast(t('bills.billAdded'));
          }}
        />
      )}
      {adding === 'expense' && (
        <ExpenseSheet
          home={home}
          residents={residents}
          onClose={() => setAdding(undefined)}
          onSaved={(next) => {
            data.setData(next);
            setAdding(undefined);
            toast(t('bills.expenseAdded'));
          }}
        />
      )}
      {bill && (
        <BillSheet bill={bill} home={home} name={name} avatar={(id) => member(id)?.avatar} onClose={() => setOpenBill(undefined)} onChanged={(next) => data.setData(next)} />
      )}
    </div>
  );
}

function BillSheet(props: {
  bill: Bill;
  home: Household;
  name: (id: string) => string;
  avatar: (id: string) => string | undefined;
  onClose: () => void;
  onChanged: (m: Money) => void;
}) {
  const { bill, home, name } = props;
  const me = home.me.id;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Money>, done: string) => {
    setBusy(true);
    try {
      props.onChanged(await fn());
      toast(done);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const due = dueText(bill.dueDate);
  const people = Object.keys(bill.shares).length;
  return (
    <Sheet title={bill.label} onClose={props.onClose}>
      <div class="big-number">{formatMoney(bill.amount, bill.currency)}</div>
      <p class="muted" style={{ marginTop: 4 }}>
        {CATEGORY_EMOJI[bill.category]} {categoryLabel(bill.category)}
        {bill.provider ? ` · ${bill.provider}` : ''}
      </p>
      <div class="card">
        <div class="row" style={{ marginBottom: 8 }}>
          <span class="muted">{t('bills.dueDate')}</span>
          <span style={{ textAlign: 'right' }}>{bill.dueDate ? formatDate(bill.dueDate, 'medium') : '—'}</span>
        </div>
        {(bill.periodStart || bill.periodEnd) && (
          <div class="row" style={{ marginBottom: 8 }}>
            <span class="muted">{t('bills.period')}</span>
            <span style={{ textAlign: 'right' }}>
              {formatDate(bill.periodStart)} – {formatDate(bill.periodEnd)}
            </span>
          </div>
        )}
        <div class="row">
          <span class="muted">{t('bills.status')}</span>
          <span style={{ textAlign: 'right' }}>
            {bill.status === 'paid' ? (
              <span class="badge ok">{t('bills.paidBy', { name: name(bill.payerId ?? '') })}</span>
            ) : (
              <span class={`badge ${due.tone}`}>{due.text}</span>
            )}
          </span>
        </div>
      </div>
      <h3 class="section-title" style={{ marginTop: 18 }}>
        {bill.shared ? t('bills.splitBetween', { count: people }) : t('bills.personalBill')}
      </h3>
      <div class="card">
        {Object.entries(bill.shares).map(([id, share]) => (
          <div class="member" key={id}>
            <CharacterAvatar id={props.avatar(id)} size={34} />
            <span style={{ flex: 1 }}>{name(id)}</span>
            <strong>{formatMoney(share, bill.currency)}</strong>
          </div>
        ))}
      </div>
      {bill.status === 'unpaid' ? (
        <>
          <button class="btn block" disabled={busy} onClick={() => run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/pay`, {}), t('bills.paidRecorded'))}>
            {busy ? <Spinner /> : t('bills.iPaid')}
          </button>
          {bill.shared && (
            <label class="field" style={{ marginTop: 14 }}>
              <span>{t('bills.someoneElse')}</span>
              <select
                class="input"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const payerId = e.currentTarget.value;
                  if (payerId) void run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/pay`, { payerId }), t('bills.payerRecorded', { name: name(payerId) }));
                }}
              >
                <option value="">{t('bills.chooseWhoPaid')}</option>
                {Object.keys(bill.shares)
                  .filter((id) => id !== me)
                  .map((id) => (
                    <option value={id} key={id}>
                      {name(id)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p class="hint">{t('bills.payerHint')}</p>
        </>
      ) : (
        <button class="btn block secondary" disabled={busy} onClick={() => run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/unpay`), t('bills.undone'))}>
          {t('bills.undo')}
        </button>
      )}
      {bill.canDelete && (
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)', marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            if (!confirm(t('bills.deleteBillConfirm', { label: bill.label }))) return;
            await run(() => api('DELETE', `/api/households/${home.id}/money/${bill.id}`), t('bills.billDeleted'));
            props.onClose();
          }}
        >
          {t('bills.deleteBill')}
        </button>
      )}
    </Sheet>
  );
}

interface BillDraft {
  label: string;
  category: string;
  amount: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  provider: string;
  shared: boolean;
  responsible: string[];
}

const youSuffix = (r: Member, me: string) => (r.id === me ? t('common.youSuffix', { name: r.name }) : r.name);

function SplitList(props: { residents: Member[]; me: string; selected: string[]; onChange: (ids: string[]) => void; shares: Record<string, number>; currency: string }) {
  return (
    <fieldset class="card" style={{ border: '1px solid var(--line)', marginTop: 8 }}>
      <legend class="sr-only">{t('addBill.splitWith')}</legend>
      {props.residents.map((r) => (
        <label class="check" key={r.id}>
          <input
            type="checkbox"
            checked={props.selected.includes(r.id)}
            onChange={(e) => props.onChange(e.currentTarget.checked ? [...props.selected, r.id] : props.selected.filter((x) => x !== r.id))}
          />
          <CharacterAvatar id={r.avatar} size={28} />
          <span style={{ flex: 1 }}>{youSuffix(r, props.me)}</span>
          {props.shares[r.id] !== undefined && <strong>{formatMoney(props.shares[r.id]!, props.currency)}</strong>}
        </label>
      ))}
    </fieldset>
  );
}

function AddBillSheet(props: { home: Household; residents: Member[]; onClose: () => void; onSaved: (m: Money) => void }) {
  const { home, residents } = props;
  const [step, setStep] = useState<'capture' | 'review'>('capture');
  const [text, setText] = useState('');
  const [ocr, setOcr] = useState<{ progress: number; stage: string } | undefined>();
  const [notice, setNotice] = useState<{ text: string; ok: boolean }>();
  const [draft, setDraft] = useState<BillDraft>({
    label: '',
    category: 'electricity',
    amount: '',
    dueDate: '',
    periodStart: '',
    periodEnd: '',
    provider: '',
    shared: true,
    responsible: residents.map((r) => r.id),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const extractor = useMemo(() => new RuleBasedExtractor({ defaultCurrency: home.currency }), [home.currency]);
  const set = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const analyse = (raw: string) => {
    const facts = extractor.extract({ source: 'manual', body: raw, receivedAt: new Date() });
    const bill = facts.find((f): f is BillFact => f.kind === 'bill');
    const receipt = facts.find((f): f is ReceiptFact => f.kind === 'receipt');
    const amountFound = bill?.amount ?? receipt?.total;
    const category = bill?.category ?? 'other';
    setDraft((d) => ({
      ...d,
      category,
      label: categoryLabel(category),
      amount: amountFound ? formatAmountInput(amountFound, home.currency) : '',
      dueDate: bill?.dueDate ?? '',
      periodStart: bill?.periodStart ?? '',
      periodEnd: bill?.periodEnd ?? '',
      provider: bill?.provider ?? receipt?.retailer ?? '',
    }));
    const found = [
      amountFound && t('addBill.foundAmount'),
      bill?.dueDate && t('addBill.foundDue'),
      bill?.periodStart && t('addBill.foundPeriod'),
    ].filter((x): x is string => Boolean(x));
    const billCurrency = bill?.currency ?? receipt?.currency;
    const mismatch = billCurrency && billCurrency !== home.currency ? ` ${t('addBill.currencyMismatch', { bill: billCurrency, home: home.currency })}` : '';
    setNotice(found.length ? { text: t('addBill.found', { fields: formatList(found) }) + mismatch, ok: true } : { text: t('addBill.notFound'), ok: false });
    setStep('review');
  };

  const fromPhoto = async (file?: File) => {
    if (!file) return;
    setError('');
    setOcr({ progress: 0, stage: 'loading' });
    try {
      const raw = await readTextFromImage(file, (progress, stage) => setOcr({ progress, stage }));
      setText(raw);
      setOcr(undefined);
      analyse(raw);
    } catch {
      setOcr(undefined);
      setError(t('addBill.ocrFailed'));
    }
  };

  const amountValue = parseAmount(draft.amount.replace(/[^\d.,]/g, '')) || 0;
  const shares = useMemo(
    () => (draft.shared && amountValue > 0 ? splitEvenly(amountValue, draft.responsible, currencyDigits(home.currency)) : {}),
    [amountValue, draft.responsible, draft.shared],
  );

  const save = async (e: Event) => {
    e.preventDefault();
    if (!(amountValue > 0)) return setError(t('addBill.amountRequired'));
    if (draft.shared && draft.responsible.length === 0) return setError(t('addBill.pickSomeone'));
    setBusy(true);
    setError('');
    try {
      const res = await api<Money>('POST', `/api/households/${home.id}/bills`, {
        label: draft.label || categoryLabel(draft.category),
        category: draft.category,
        amount: amountValue,
        dueDate: draft.dueDate || undefined,
        periodStart: draft.periodStart || undefined,
        periodEnd: draft.periodEnd || undefined,
        provider: draft.provider || undefined,
        shared: draft.shared,
        responsible: draft.shared ? draft.responsible : undefined,
      });
      props.onSaved(res);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (step === 'capture') {
    return (
      <Sheet title={t('addBill.title')} onClose={props.onClose}>
        {ocr ? (
          <div class="card" role="status">
            <strong>{ocr.stage === 'reading' ? t('addBill.ocrReading') : t('addBill.ocrLoading')}</strong>
            <div class="progress">
              <div style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
            </div>
            <p class="hint">{t('addBill.ocrNote')}</p>
          </div>
        ) : (
          <>
            <div class="row" style={{ marginBottom: 16 }}>
              <button class="btn secondary" onClick={() => cameraRef.current?.click()}>
                <Icon.camera /> {t('addBill.takePhoto')}
              </button>
              <button class="btn secondary" onClick={() => galleryRef.current?.click()}>
                <Icon.image /> {t('addBill.choosePhoto')}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromPhoto(e.currentTarget.files?.[0])} />
            <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => fromPhoto(e.currentTarget.files?.[0])} />
            <label class="field">
              <span>{t('addBill.pasteLabel')}</span>
              <textarea class="input" name="billText" rows={7} placeholder={t('addBill.pastePlaceholder')} value={text} onInput={(e) => setText(e.currentTarget.value)} />
            </label>
            {error && (
              <p class="error-text" role="alert">
                {error}
              </p>
            )}
            <button class="btn block" disabled={!text.trim()} onClick={() => analyse(text)}>
              {t('addBill.extract')}
            </button>
            <button
              class="btn block ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                setNotice(undefined);
                set('label', categoryLabel(draft.category));
                setStep('review');
              }}
            >
              {t('addBill.manual')}
            </button>
          </>
        )}
      </Sheet>
    );
  }

  const categoryLabels = CATEGORIES.map(categoryLabel);
  return (
    <Sheet title={t('addBill.reviewTitle')} onClose={props.onClose} back={() => setStep('capture')}>
      {notice && <div class={`banner ${notice.ok ? 'info' : 'error'}`}>{notice.text}</div>}
      <form onSubmit={save}>
        <div class="row">
          <label class="field">
            <span>{t('addBill.category')}</span>
            <select
              class="input"
              name="category"
              value={draft.category}
              onChange={(e) => {
                const category = e.currentTarget.value;
                // Keep a custom name; replace a default one.
                setDraft((d) => ({ ...d, category, label: !d.label || categoryLabels.includes(d.label) ? categoryLabel(category) : d.label }));
              }}
            >
              {CATEGORIES.map((k) => (
                <option value={k} key={k}>
                  {CATEGORY_EMOJI[k]} {categoryLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>{t('addBill.amount', { currency: home.currency })}</span>
            <input class="input" name="amount" inputMode="decimal" value={draft.amount} onInput={(e) => set('amount', e.currentTarget.value)} placeholder="0" required />
          </label>
        </div>
        <label class="field">
          <span>{t('addBill.name')}</span>
          <input class="input" name="label" value={draft.label} onInput={(e) => set('label', e.currentTarget.value)} maxLength={80} />
        </label>
        <label class="field">
          <span>{t('bills.dueDate')}</span>
          <input class="input" name="dueDate" type="date" value={draft.dueDate} onInput={(e) => set('dueDate', e.currentTarget.value)} />
        </label>
        <div class="row">
          <label class="field">
            <span>{t('addBill.periodFrom')}</span>
            <input class="input" name="periodStart" type="date" value={draft.periodStart} onInput={(e) => set('periodStart', e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>{t('addBill.periodTo')}</span>
            <input class="input" name="periodEnd" type="date" value={draft.periodEnd} onInput={(e) => set('periodEnd', e.currentTarget.value)} />
          </label>
        </div>
        <label class="field">
          <span>{t('addBill.provider')}</span>
          <input class="input" name="provider" value={draft.provider} onInput={(e) => set('provider', e.currentTarget.value)} maxLength={80} />
        </label>
        <Switch
          checked={draft.shared}
          onChange={(v) => set('shared', v)}
          label={t('addBill.sharedSwitch')}
          hint={draft.shared ? t('addBill.sharedHint') : t('addBill.personalHint')}
        />
        {draft.shared && (
          <SplitList residents={residents} me={home.me.id} selected={draft.responsible} onChange={(ids) => set('responsible', ids)} shares={shares} currency={home.currency} />
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : t('addBill.save')}
        </button>
      </form>
    </Sheet>
  );
}

function ExpenseSheet(props: { home: Household; residents: Member[]; onClose: () => void; onSaved: (m: Money) => void }) {
  const { home, residents } = props;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(home.me.id);
  const [shared, setShared] = useState(true);
  const [participants, setParticipants] = useState(residents.map((r) => r.id));
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = parseAmount(amount.replace(/[^\d.,]/g, '')) || 0;
  const shares = shared && value > 0 ? splitEvenly(value, participants, currencyDigits(home.currency)) : {};

  const save = async (e: Event) => {
    e.preventDefault();
    if (!description.trim()) return setError(t('expense.descriptionRequired'));
    if (!(value > 0)) return setError(t('addBill.amountRequired'));
    setBusy(true);
    setError('');
    try {
      props.onSaved(
        await api<Money>('POST', `/api/households/${home.id}/expenses`, {
          description,
          amount: value,
          date,
          shared,
          paidBy: shared ? paidBy : undefined,
          participants: shared ? participants : undefined,
        }),
      );
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title={t('expense.title')} onClose={props.onClose}>
      <form onSubmit={save}>
        <label class="field">
          <span>{t('expense.what')}</span>
          <input class="input" name="description" placeholder={t('expense.whatPlaceholder')} value={description} onInput={(e) => setDescription(e.currentTarget.value)} maxLength={120} />
        </label>
        <div class="row">
          <label class="field">
            <span>{t('expense.amount', { currency: home.currency })}</span>
            <input class="input" name="amount" inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} placeholder="0" />
          </label>
          <label class="field">
            <span>{t('expense.date')}</span>
            <input class="input" type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
        </div>
        <Switch checked={shared} onChange={setShared} label={t('expense.sharedSwitch')} hint={shared ? t('expense.sharedHint') : t('expense.personalHint')} />
        {shared && (
          <>
            <label class="field" style={{ marginTop: 8 }}>
              <span>{t('expense.whoPaid')}</span>
              <select class="input" value={paidBy} onChange={(e) => setPaidBy(e.currentTarget.value)}>
                {residents.map((r) => (
                  <option value={r.id} key={r.id}>
                    {youSuffix(r, home.me.id)}
                  </option>
                ))}
              </select>
            </label>
            <SplitList residents={residents} me={home.me.id} selected={participants} onChange={setParticipants} shares={shares} currency={home.currency} />
          </>
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : t('common.save')}
        </button>
      </form>
    </Sheet>
  );
}
