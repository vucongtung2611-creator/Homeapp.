import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RuleBasedExtractor, parseAmount, type BillFact, type ReceiptFact } from '../../../src/integrations/understand.js';
import { currencyDigits, splitEvenly } from '../../../src/modules/finance.js';
import { api, type Bill, type Household, type Member, type Money } from '../api.js';
import { readTextFromImage } from '../ocr.js';
import type { Live } from '../router.js';
import { Avatar, EmptyState, ErrorState, Icon, Sheet, Skeleton, Spinner, Switch, toast, toastError, useLoad } from '../ui.js';
import { CATEGORY, amountInput, dueText, errorText, money, todayIso, viDate } from '../util.js';

const RESIDENT = ['owner', 'tenant', 'family_member', 'child'];

export function BillsScreen({ home, live }: { home: Household; live: Live }) {
  const data = useLoad(() => api<Money>('GET', `/api/households/${home.id}/money`), [home.id]);
  const [adding, setAdding] = useState<'choose' | 'bill' | 'expense'>();
  const [openBill, setOpenBill] = useState<string>();
  useEffect(() => live.on((e) => ((e.type === 'changed' && e.area === 'bills') || e.type === 'resync' ? void data.reload(true) : undefined)), [live]);

  const m = data.data;
  const me = home.me.id;
  const name = (id: string) => (id === me ? 'Bạn' : (m?.members.find((x) => x.id === id)?.name ?? home.members.find((x) => x.id === id)?.name ?? 'Người cũ'));
  const residents = home.members.filter((x) => RESIDENT.includes(x.role));

  if (data.loading && !m)
    return (
      <div class="page">
        <div class="skeleton" style={{ height: 150, marginBottom: 14 }} />
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

  const settle = async (t: { from: string; to: string; amount: number }) => {
    const label = t.from === me ? `Xác nhận bạn đã chuyển ${money(t.amount, m.currency)} cho ${name(t.to)}?` : `Xác nhận bạn đã nhận ${money(t.amount, m.currency)} từ ${name(t.from)}?`;
    if (!confirm(label)) return;
    try {
      data.setData(await api<Money>('POST', `/api/households/${home.id}/settlements`, t));
      toast('Đã ghi nhận 👍');
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div class="page">
      <section class="card brand" aria-label="Tình hình của bạn">
        {myBalance < 0 ? (
          <>
            <div class="muted">Bạn cần trả</div>
            <div class="big-number">{money(-myBalance, m.currency)}</div>
          </>
        ) : myBalance > 0 ? (
          <>
            <div class="muted">Mọi người còn nợ bạn</div>
            <div class="big-number">{money(myBalance, m.currency)}</div>
          </>
        ) : (
          <>
            <div class="muted">Tình hình của bạn</div>
            <div class="big-number">Sòng phẳng ✨</div>
          </>
        )}
        <div class="muted" style={{ fontSize: 16 }}>
          {unpaid.length ? `${unpaid.length} hóa đơn chưa trả` : 'Không có hóa đơn chưa trả'}
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
            <span style={{ flex: 1 }}>
              {r.label}: {dueText(r.dueDate).text.toLowerCase()} · {money(r.amount, m.currency)}
            </span>
          </button>
        ))}

      <h2 class="section-title">Ai nợ ai</h2>
      <section class="card">
        {m.transfers.length === 0 ? (
          <p class="muted" style={{ margin: 0 }}>
            Không ai nợ ai. Khi có người trả một hóa đơn chung, phần của từng người sẽ hiện ở đây.
          </p>
        ) : (
          m.transfers.map((t) => (
            <div class="transfer" key={`${t.from}-${t.to}`}>
              <Avatar id={t.from} name={name(t.from)} />
              <div class="grow">
                <div>
                  <strong>{name(t.from)}</strong> → <strong>{name(t.to)}</strong>
                </div>
                <div class="amount">{money(t.amount, m.currency)}</div>
              </div>
              {(t.from === me || t.to === me) && (
                <button class="btn small secondary" onClick={() => settle(t)}>
                  {t.from === me ? 'Đã trả' : 'Đã nhận'}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      <h2 class="section-title">Hóa đơn</h2>
      {m.bills.length === 0 ? (
        <EmptyState
          art="🧾"
          title="Chưa có hóa đơn"
          text="Dán email hóa đơn hoặc chụp ảnh, app sẽ tự tách số tiền, hạn trả và chia cho mọi người."
          action={
            <button class="btn" onClick={() => setAdding('bill')}>
              Thêm hóa đơn
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
                <button class="list-item" onClick={() => setOpenBill(b.id)} style={b.status === 'paid' ? { opacity: 0.72 } : undefined}>
                  <span class="emoji">{CATEGORY[b.category]?.emoji ?? '🧾'}</span>
                  <span class="grow">
                    <span class="title">{b.label}</span>
                    <span class="meta">
                      {b.status === 'paid' ? (
                        <span class="badge ok">{name(b.payerId ?? '')} đã trả</span>
                      ) : (
                        <span class={`badge ${due.tone}`}>{due.text}</span>
                      )}{' '}
                      {!b.shared && <span class="badge">🔒 Riêng</span>}
                      {b.sample && <span class="badge">Mẫu</span>}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span class="amount" style={{ display: 'block' }}>
                      {money(b.amount, b.currency)}
                    </span>
                    {mine !== undefined && b.shared && (
                      <span class="meta" style={{ fontSize: 14 }}>
                        Phần bạn {money(mine, b.currency)}
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
          <h2 class="section-title">Chi tiêu &amp; chuyển tiền</h2>
          <ul class="list">
            {m.expenses.slice(0, 20).map((x) => (
              <li key={x.id} class="list-item" style={{ cursor: 'default' }}>
                <span class="emoji">{x.kind === 'settlement' ? '🤝' : x.shared ? '🛒' : '🔒'}</span>
                <span class="grow">
                  <span class="title">{x.kind === 'settlement' ? `${name(x.paidBy)} trả ${name(x.participants[0] ?? '')}` : x.label}</span>
                  <span class="meta">
                    {viDate(x.date)} · {x.kind === 'settlement' ? 'Chuyển tiền' : x.shared ? `${name(x.paidBy)} trả, chia ${x.participants.length} người` : 'Chi tiêu riêng'}
                  </span>
                </span>
                <span class="amount">{money(x.amount, m.currency)}</span>
                {x.canDelete && (
                  <button
                    class="icon-btn"
                    aria-label="Xoá"
                    onClick={async () => {
                      if (!confirm('Xoá mục này?')) return;
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
        <Icon.plus /> Thêm
      </button>

      {adding === 'choose' && (
        <Sheet title="Thêm" onClose={() => setAdding(undefined)}>
          <div class="choice-grid">
            <button class="choice" onClick={() => setAdding('bill')}>
              <span class="emoji">🧾</span>
              <span>
                <strong>Hóa đơn</strong>
                <small>Dán email, chụp ảnh, hoặc nhập tay. Điện, nước, internet, tiền nhà…</small>
              </span>
            </button>
            <button class="choice" onClick={() => setAdding('expense')}>
              <span class="emoji">🛒</span>
              <span>
                <strong>Chi tiêu chung</strong>
                <small>Đi chợ, đồ dùng chung, ai đó trả trước cho cả nhà</small>
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
            toast('Đã thêm hóa đơn');
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
            toast('Đã thêm chi tiêu');
          }}
        />
      )}
      {bill && <BillSheet bill={bill} home={home} name={name} onClose={() => setOpenBill(undefined)} onChanged={(next) => data.setData(next)} />}
    </div>
  );
}

function BillSheet(props: { bill: Bill; home: Household; name: (id: string) => string; onClose: () => void; onChanged: (m: Money) => void }) {
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
  return (
    <Sheet title={bill.label} onClose={props.onClose}>
      <div class="big-number">{money(bill.amount, bill.currency)}</div>
      <p class="muted" style={{ marginTop: 4 }}>
        {CATEGORY[bill.category]?.emoji} {CATEGORY[bill.category]?.label ?? bill.category}
        {bill.provider ? ` · ${bill.provider}` : ''}
      </p>
      <div class="card">
        <div class="row" style={{ marginBottom: 8 }}>
          <span class="muted">Hạn trả</span>
          <span style={{ textAlign: 'right' }}>{bill.dueDate ? `${viDate(bill.dueDate)}` : '—'}</span>
        </div>
        {(bill.periodStart || bill.periodEnd) && (
          <div class="row" style={{ marginBottom: 8 }}>
            <span class="muted">Kỳ thanh toán</span>
            <span style={{ textAlign: 'right' }}>
              {viDate(bill.periodStart)} – {viDate(bill.periodEnd)}
            </span>
          </div>
        )}
        <div class="row">
          <span class="muted">Trạng thái</span>
          <span style={{ textAlign: 'right' }}>
            {bill.status === 'paid' ? <span class="badge ok">{name(bill.payerId ?? '')} đã trả</span> : <span class={`badge ${due.tone}`}>{due.text}</span>}
          </span>
        </div>
      </div>
      <h3 class="section-title" style={{ marginTop: 18 }}>
        {bill.shared ? `Chia cho ${Object.keys(bill.shares).length} người` : 'Hóa đơn riêng của bạn'}
      </h3>
      <div class="card">
        {Object.entries(bill.shares).map(([id, share]) => (
          <div class="member" key={id}>
            <Avatar id={id} name={name(id)} />
            <span style={{ flex: 1 }}>{name(id)}</span>
            <strong>{money(share, bill.currency)}</strong>
          </div>
        ))}
      </div>
      {bill.status === 'unpaid' ? (
        <>
          <button class="btn block" disabled={busy} onClick={() => run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/pay`, {}), 'Đã ghi nhận bạn trả hóa đơn')}>
            {busy ? <Spinner /> : 'Tôi đã trả hóa đơn này'}
          </button>
          {bill.shared && (
            <label class="field" style={{ marginTop: 14 }}>
              <span>Hoặc người khác đã trả:</span>
              <select
                class="input"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const payerId = e.currentTarget.value;
                  if (payerId) void run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/pay`, { payerId }), `Đã ghi nhận ${name(payerId)} trả`);
                }}
              >
                <option value="">Chọn người đã trả…</option>
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
          <p class="hint">Người trả sẽ được những người còn lại trả lại phần của họ — xem ở mục “Ai nợ ai”.</p>
        </>
      ) : (
        <button class="btn block secondary" disabled={busy} onClick={() => run(() => api('POST', `/api/households/${home.id}/bills/${bill.id}/unpay`), 'Đã hoàn tác')}>
          Hoàn tác: chưa trả
        </button>
      )}
      {bill.canDelete && (
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)', marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Xoá hóa đơn “${bill.label}”?`)) return;
            await run(() => api('DELETE', `/api/households/${home.id}/money/${bill.id}`), 'Đã xoá hóa đơn');
            props.onClose();
          }}
        >
          Xoá hóa đơn
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

function AddBillSheet(props: { home: Household; residents: Member[]; onClose: () => void; onSaved: (m: Money) => void }) {
  const { home, residents } = props;
  const [step, setStep] = useState<'capture' | 'review'>('capture');
  const [text, setText] = useState('');
  const [ocr, setOcr] = useState<{ progress: number; stage: string } | undefined>();
  const [notice, setNotice] = useState('');
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

  const analyse = (raw: string) => {
    const facts = extractor.extract({ source: 'manual', body: raw, receivedAt: new Date() });
    const bill = facts.find((f): f is BillFact => f.kind === 'bill');
    const receipt = facts.find((f): f is ReceiptFact => f.kind === 'receipt');
    const amountFound = bill?.amount ?? receipt?.total;
    const category = bill?.category ?? 'other';
    setDraft((d) => ({
      ...d,
      category,
      label: CATEGORY[category]?.label ?? 'Hóa đơn',
      amount: amountFound ? amountInput(amountFound, home.currency) : '',
      dueDate: bill?.dueDate ?? '',
      periodStart: bill?.periodStart ?? '',
      periodEnd: bill?.periodEnd ?? '',
      provider: bill?.provider ?? receipt?.retailer ?? '',
    }));
    const currencyMismatch = (bill?.currency ?? receipt?.currency) && (bill?.currency ?? receipt?.currency) !== home.currency;
    const found = [amountFound && 'số tiền', bill?.dueDate && 'hạn trả', bill?.periodStart && 'kỳ thanh toán'].filter(Boolean);
    setNotice(
      found.length
        ? `Đã tìm thấy ${found.join(', ')}. Kiểm tra lại trước khi lưu.${currencyMismatch ? ` Lưu ý: hóa đơn có vẻ dùng ${bill?.currency ?? receipt?.currency}, nhà bạn dùng ${home.currency}.` : ''}`
        : 'Không tìm thấy số tiền. Hãy nhập tay bên dưới.',
    );
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
      setError('Không đọc được chữ trong ảnh. Thử chụp gần và rõ hơn, hoặc dán chữ / nhập tay.');
    }
  };

  const amountValue = parseAmount(draft.amount.replace(/[^\d.,]/g, '')) || 0;
  const shares = useMemo(
    () => (draft.shared && amountValue > 0 ? splitEvenly(amountValue, draft.responsible, currencyDigits(home.currency)) : {}),
    [amountValue, draft.responsible, draft.shared],
  );

  const save = async (e: Event) => {
    e.preventDefault();
    if (!(amountValue > 0)) return setError('Hãy nhập số tiền.');
    if (draft.shared && draft.responsible.length === 0) return setError('Hãy chọn ít nhất một người để chia.');
    setBusy(true);
    setError('');
    try {
      const res = await api<Money>('POST', `/api/households/${home.id}/bills`, {
        label: draft.label || CATEGORY[draft.category]?.label,
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

  const set = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (step === 'capture') {
    return (
      <Sheet title="Thêm hóa đơn" onClose={props.onClose}>
        {ocr ? (
          <div class="card" role="status">
            <strong>{ocr.stage === 'reading' ? 'Đang đọc chữ trong ảnh…' : 'Đang chuẩn bị bộ đọc chữ…'}</strong>
            <div class="progress">
              <div style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
            </div>
            <p class="hint">Ảnh được đọc ngay trên máy bạn, không gửi đi đâu. Lần đầu cần tải bộ đọc chữ (~5 MB).</p>
          </div>
        ) : (
          <>
            <div class="row" style={{ marginBottom: 16 }}>
              <button class="btn secondary" onClick={() => cameraRef.current?.click()}>
                <Icon.camera /> Chụp ảnh
              </button>
              <button class="btn secondary" onClick={() => galleryRef.current?.click()}>
                <Icon.image /> Chọn ảnh
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromPhoto(e.currentTarget.files?.[0])} />
            <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => fromPhoto(e.currentTarget.files?.[0])} />
            <label class="field">
              <span>Hoặc dán nội dung email / tin nhắn hóa đơn</span>
              <textarea
                class="input"
                name="billText"
                rows={7}
                placeholder={'VD: Tổng tiền thanh toán: 850.000 đ\nHạn thanh toán: 15/10/2026\nKỳ thanh toán: từ 01/09 đến 30/09/2026'}
                value={text}
                onInput={(e) => setText(e.currentTarget.value)}
              />
            </label>
            {error && (
              <p class="error-text" role="alert">
                {error}
              </p>
            )}
            <button class="btn block" disabled={!text.trim()} onClick={() => analyse(text)}>
              Tách thông tin
            </button>
            <button
              class="btn block ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                setNotice('');
                set('label', CATEGORY[draft.category]?.label ?? '');
                setStep('review');
              }}
            >
              Nhập tay
            </button>
          </>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title="Kiểm tra hóa đơn" onClose={props.onClose} back={() => setStep('capture')}>
      {notice && <div class={`banner ${notice.startsWith('Không') ? 'error' : ''}`} style={notice.startsWith('Không') ? undefined : { background: 'var(--brand-soft)', color: 'var(--brand-strong)' }}>{notice}</div>}
      <form onSubmit={save}>
        <div class="row">
          <label class="field">
            <span>Loại</span>
            <select
              class="input"
              name="category"
              value={draft.category}
              onChange={(e) => {
                const category = e.currentTarget.value;
                setDraft((d) => ({ ...d, category, label: !d.label || Object.values(CATEGORY).some((c) => c.label === d.label) ? (CATEGORY[category]?.label ?? d.label) : d.label }));
              }}
            >
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option value={k} key={k}>
                  {v.emoji} {v.label}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Số tiền ({home.currency})</span>
            <input class="input" name="amount" inputMode="decimal" value={draft.amount} onInput={(e) => set('amount', e.currentTarget.value)} placeholder="0" required />
          </label>
        </div>
        <label class="field">
          <span>Tên</span>
          <input class="input" name="label" value={draft.label} onInput={(e) => set('label', e.currentTarget.value)} maxLength={80} />
        </label>
        <label class="field">
          <span>Hạn trả</span>
          <input class="input" name="dueDate" type="date" value={draft.dueDate} onInput={(e) => set('dueDate', e.currentTarget.value)} />
        </label>
        <div class="row">
          <label class="field">
            <span>Kỳ từ</span>
            <input class="input" name="periodStart" type="date" value={draft.periodStart} onInput={(e) => set('periodStart', e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>đến</span>
            <input class="input" name="periodEnd" type="date" value={draft.periodEnd} onInput={(e) => set('periodEnd', e.currentTarget.value)} />
          </label>
        </div>
        <label class="field">
          <span>Nhà cung cấp (không bắt buộc)</span>
          <input class="input" name="provider" value={draft.provider} onInput={(e) => set('provider', e.currentTarget.value)} maxLength={80} />
        </label>
        <Switch
          checked={draft.shared}
          onChange={(v) => set('shared', v)}
          label="Chi phí chung — chia tiền"
          hint={draft.shared ? 'Hóa đơn sẽ được chia cho những người được chọn.' : 'Chỉ mình bạn thấy, không chia cho ai.'}
        />
        {draft.shared && (
          <fieldset class="card" style={{ border: 0, marginTop: 8 }}>
            <legend class="sr-only">Chia cho</legend>
            {residents.map((r) => (
              <label class="check" key={r.id}>
                <input
                  type="checkbox"
                  checked={draft.responsible.includes(r.id)}
                  onChange={(e) =>
                    set('responsible', e.currentTarget.checked ? [...draft.responsible, r.id] : draft.responsible.filter((x) => x !== r.id))
                  }
                />
                <span style={{ flex: 1 }}>{r.id === home.me.id ? `${r.name} (bạn)` : r.name}</span>
                {shares[r.id] !== undefined && <strong>{money(shares[r.id]!, home.currency)}</strong>}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : 'Lưu hóa đơn'}
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
    if (!description.trim()) return setError('Hãy nhập mô tả.');
    if (!(value > 0)) return setError('Hãy nhập số tiền.');
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
    <Sheet title="Chi tiêu chung" onClose={props.onClose}>
      <form onSubmit={save}>
        <label class="field">
          <span>Mua gì?</span>
          <input class="input" name="description" placeholder="VD: Đi chợ cuối tuần" value={description} onInput={(e) => setDescription(e.currentTarget.value)} maxLength={120} />
        </label>
        <div class="row">
          <label class="field">
            <span>Số tiền ({home.currency})</span>
            <input class="input" name="amount" inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} placeholder="0" />
          </label>
          <label class="field">
            <span>Ngày</span>
            <input class="input" type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
        </div>
        <Switch
          checked={shared}
          onChange={setShared}
          label="Chi phí chung — chia tiền"
          hint={shared ? 'Chỉ chi phí chung mới được chia.' : 'Ghi lại cho riêng bạn, không chia.'}
        />
        {shared && (
          <>
            <label class="field" style={{ marginTop: 8 }}>
              <span>Ai đã trả?</span>
              <select class="input" value={paidBy} onChange={(e) => setPaidBy(e.currentTarget.value)}>
                {residents.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.id === home.me.id ? `${r.name} (bạn)` : r.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset class="card" style={{ border: 0 }}>
              <legend class="sr-only">Chia cho</legend>
              {residents.map((r) => (
                <label class="check" key={r.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(r.id)}
                    onChange={(e) => setParticipants(e.currentTarget.checked ? [...participants, r.id] : participants.filter((x) => x !== r.id))}
                  />
                  <span style={{ flex: 1 }}>{r.id === home.me.id ? `${r.name} (bạn)` : r.name}</span>
                  {shares[r.id] !== undefined && <strong>{money(shares[r.id]!, home.currency)}</strong>}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button class="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Spinner /> : 'Lưu'}
        </button>
      </form>
    </Sheet>
  );
}
