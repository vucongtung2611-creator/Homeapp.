import type { GraphNode } from '../graph/types.js';
import { PermissionDeniedError } from '../permissions/AccessControl.js';
import type { BillCategory } from '../integrations/understand.js';
import type { Platform } from '../platform.js';
import type { Coordination, TaskProps } from './tasks.js';

export interface BillProps extends Record<string, unknown> {
  category: BillCategory | string;
  amount: number;
  currency: string;
  provider?: string;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  /** Only shared bills take part in splitting and settle-up. */
  shared: boolean;
  /** userId -> share of the bill. */
  shares: Record<string, number>;
  status: 'unpaid' | 'paid';
  /** Who paid the provider; the others then owe them their shares. */
  payerId?: string;
  paidAt?: string;
}

export interface TransactionProps extends Record<string, unknown> {
  /** `settlement` = money moved between members to square up. */
  kind: 'expense' | 'settlement';
  amount: number;
  currency: string;
  category: string;
  date: string; // ISO date
  paidBy: string;
  /** Who the cost is split between (for a settlement: the recipient). */
  participants: string[];
  /** Only expenses explicitly marked shared enter splitting and settle-up. */
  shared: boolean;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export type ReminderKind = 'bill_due' | 'bill_overdue' | 'debt';

export interface Reminder {
  /** Stable key, used to avoid sending the same reminder twice in a day. */
  key: string;
  kind: ReminderKind;
  userId: string;
  amount: number;
  currency: string;
  billId?: string;
  label?: string;
  dueDate?: string;
  /** For debts: who should be paid. */
  to?: string;
}

export interface MonthlyReport {
  month: string;
  currency: string;
  total: number;
  byCategory: Record<string, number>;
  bills: { id: string; label: string; amount: number; status: BillProps['status'] }[];
}

const DAY = 86_400_000;

/** Number of minor-unit digits for a currency (VND → 0, AUD → 2). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

const toMinor = (n: number, digits: number) => Math.round(n * 10 ** digits);
const fromMinor = (m: number, digits: number) => m / 10 ** digits;

/**
 * Household finance: bills, shared expenses and settle-up. Members share the
 * *outcome* (who owes whom) without exposing their personal transactions:
 * only costs explicitly marked shared ever enter the split.
 */
export class Finance {
  constructor(
    private readonly p: Platform,
    private readonly coordination: Coordination,
  ) {}

  recordBill(
    actorId: string,
    householdId: string,
    input: {
      category: BillCategory | string;
      amount: number;
      currency?: string;
      provider?: string;
      dueDate?: string;
      periodStart?: string;
      periodEnd?: string;
      /** Defaults to true: a household bill is shared unless said otherwise. */
      shared?: boolean;
      responsible?: string[];
      label?: string;
    },
  ): GraphNode<BillProps> {
    this.p.acl.assertCreate(actorId, householdId, 'finance');
    const shared = input.shared ?? true;
    const responsible = shared ? (input.responsible ?? this.p.residents(householdId).map((r) => r.id)) : [actorId];
    const currency = input.currency ?? this.currency(householdId);
    const bill = this.p.graph.addNode<BillProps>({
      type: 'bill',
      householdId,
      domain: 'finance',
      label: input.label ?? `${capitalise(input.category)} bill`,
      ownerId: actorId,
      visibility: shared ? 'household' : 'private',
      props: {
        category: input.category,
        amount: input.amount,
        currency,
        provider: input.provider,
        dueDate: input.dueDate,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        shared,
        shares: splitEvenly(input.amount, responsible, currencyDigits(currency)),
        status: 'unpaid',
      },
    });
    for (const userId of responsible) this.p.graph.link(bill.id, 'responsible', userId);
    this.coordination.createTask(actorId, householdId, {
      title: `Pay ${bill.label.toLowerCase()}`,
      domain: 'finance',
      dueOn: input.dueDate,
      assignees: responsible,
      subjectId: bill.id,
    });
    return bill;
  }

  /** Re-split a bill by weights (e.g. room size); default is an even split. */
  splitBill(actorId: string, billId: string, weights?: Record<string, number>): Record<string, number> {
    const bill = this.p.graph.requireNode<BillProps>(billId);
    this.p.acl.assertWrite(actorId, bill);
    const digits = currencyDigits(bill.props.currency);
    const people = weights ? Object.keys(weights) : Object.keys(bill.props.shares);
    const shares = weights ? splitWeighted(bill.props.amount, weights, digits) : splitEvenly(bill.props.amount, people, digits);
    for (const userId of Object.keys(bill.props.shares)) this.p.graph.unlink(bill.id, 'responsible', userId);
    for (const userId of Object.keys(shares)) this.p.graph.link(bill.id, 'responsible', userId);
    this.p.graph.updateNode<BillProps>(billId, { shares });
    return shares;
  }

  /** Record that `payerId` paid the provider. Everyone else now owes them their share. */
  payBill(actorId: string, billId: string, payerId: string = actorId): GraphNode<BillProps> {
    const bill = this.p.graph.requireNode<BillProps>(billId);
    this.assertCanSettleBill(actorId, bill);
    this.p.graph.link(bill.id, 'paid_by', payerId);
    for (const task of this.p.graph.neighbors<TaskProps>(bill.id, { relation: 'about', direction: 'in', type: 'task' })) {
      this.p.graph.updateNode<TaskProps>(task.id, { status: 'done' });
    }
    return this.p.graph.updateNode<BillProps>(billId, {
      status: 'paid',
      payerId,
      paidAt: this.p.now().toISOString(),
    });
  }

  /** Undo a payment recorded by mistake. */
  unpayBill(actorId: string, billId: string): GraphNode<BillProps> {
    const bill = this.p.graph.requireNode<BillProps>(billId);
    this.assertCanSettleBill(actorId, bill);
    if (bill.props.payerId) this.p.graph.unlink(bill.id, 'paid_by', bill.props.payerId);
    for (const task of this.p.graph.neighbors<TaskProps>(bill.id, { relation: 'about', direction: 'in', type: 'task' })) {
      this.p.graph.updateNode<TaskProps>(task.id, { status: 'open' });
    }
    return this.p.graph.updateNode<BillProps>(billId, { status: 'unpaid', payerId: undefined, paidAt: undefined });
  }

  recordExpense(
    actorId: string,
    householdId: string,
    input: {
      description: string;
      amount: number;
      currency?: string;
      category: string;
      date?: string;
      paidBy?: string;
      /** Only shared expenses are split. Defaults to false (personal). */
      shared?: boolean;
      /** Who a shared expense is split between; defaults to all residents. */
      participants?: string[];
    },
  ): GraphNode<TransactionProps> {
    this.p.acl.assertCreate(actorId, householdId, 'finance');
    const paidBy = input.paidBy ?? actorId;
    const shared = input.shared ?? false;
    const participants = shared ? (input.participants ?? this.p.residents(householdId).map((r) => r.id)) : [paidBy];
    const tx = this.p.graph.addNode<TransactionProps>({
      type: 'transaction',
      householdId,
      domain: 'finance',
      label: input.description,
      ownerId: actorId,
      visibility: shared ? 'household' : 'private',
      props: {
        kind: 'expense',
        amount: input.amount,
        currency: input.currency ?? this.currency(householdId),
        category: input.category,
        date: input.date ?? this.p.now().toISOString().slice(0, 10),
        paidBy,
        participants,
        shared,
      },
    });
    this.p.graph.link(tx.id, 'paid_by', paidBy);
    return tx;
  }

  /** Mark an existing expense as shared (or personal again). Owner only. */
  setExpenseShared(actorId: string, txId: string, shared: boolean, participants?: string[]): GraphNode<TransactionProps> {
    const tx = this.p.graph.requireNode<TransactionProps>(txId);
    if (tx.ownerId !== actorId) throw new PermissionDeniedError(actorId, 'change sharing of', txId);
    if (tx.props.kind !== 'expense') throw new Error('Only expenses can be shared');
    // The receipt stays private: sharing the cost is not sharing the purchase.
    this.p.setVisibility(actorId, txId, shared ? 'household' : 'private', false);
    return this.p.graph.updateNode<TransactionProps>(txId, {
      shared,
      participants: shared ? (participants ?? this.p.residents(tx.householdId).map((r) => r.id)) : [tx.props.paidBy],
    });
  }

  /** "I sent An 200,000đ" — moves money between members to square up. */
  recordSettlement(
    actorId: string,
    householdId: string,
    input: { from: string; to: string; amount: number; date?: string },
  ): GraphNode<TransactionProps> {
    this.p.acl.assertCreate(actorId, householdId, 'finance');
    if (actorId !== input.from && actorId !== input.to) {
      throw new PermissionDeniedError(actorId, 'record a payment between', `${input.from} and ${input.to}`);
    }
    const tx = this.p.graph.addNode<TransactionProps>({
      type: 'transaction',
      householdId,
      domain: 'finance',
      label: 'Settle up',
      ownerId: actorId,
      props: {
        kind: 'settlement',
        amount: input.amount,
        currency: this.currency(householdId),
        category: 'settlement',
        date: input.date ?? this.p.now().toISOString().slice(0, 10),
        paidBy: input.from,
        participants: [input.to],
        shared: true,
      },
    });
    this.p.graph.link(tx.id, 'paid_by', input.from);
    return tx;
  }

  /** Delete a bill or transaction. The creator or the household owner may do this. */
  remove(actorId: string, nodeId: string): void {
    const node = this.p.graph.requireNode(nodeId);
    if (node.type !== 'bill' && node.type !== 'transaction') throw new Error(`${nodeId} is not a bill or transaction`);
    const isHouseholdOwner = this.p.acl.roleOf(actorId, node.householdId) === 'owner';
    if (node.ownerId !== actorId && !(isHouseholdOwner && node.visibility === 'household')) {
      throw new PermissionDeniedError(actorId, 'delete', nodeId);
    }
    for (const task of this.p.graph.neighbors(nodeId, { relation: 'about', direction: 'in', type: 'task' })) {
      this.p.graph.removeNode(task.id);
    }
    this.p.graph.removeNode(nodeId);
  }

  /** Net position per member from shared costs (positive = is owed money). */
  balances(actorId: string, householdId: string): Record<string, number> {
    const digits = currencyDigits(this.currency(householdId));
    const net = new Map<string, number>();
    const add = (user: string, minor: number) => net.set(user, (net.get(user) ?? 0) + minor);

    for (const tx of this.p.acl.visible<TransactionProps>(actorId, householdId, 'transaction')) {
      const { shared, participants, paidBy, amount } = tx.props;
      if (!shared || participants.length === 0) continue;
      add(paidBy, toMinor(amount, digits));
      for (const [user, share] of Object.entries(splitEvenly(amount, participants, digits))) add(user, -toMinor(share, digits));
    }
    for (const bill of this.p.acl.visible<BillProps>(actorId, householdId, 'bill')) {
      const { shared, status, payerId, amount, shares } = bill.props;
      if (!shared || status !== 'paid' || !payerId) continue;
      add(payerId, toMinor(amount, digits));
      for (const [user, share] of Object.entries(shares)) add(user, -toMinor(share, digits));
    }
    return Object.fromEntries([...net].filter(([, m]) => m !== 0).map(([u, m]) => [u, fromMinor(m, digits)]));
  }

  /** Minimal set of transfers that settles all shared costs. */
  settleUp(actorId: string, householdId: string): Transfer[] {
    const digits = currencyDigits(this.currency(householdId));
    const entries = Object.entries(this.balances(actorId, householdId)).map(([u, a]) => ({ u, c: toMinor(a, digits) }));
    const creditors = entries.filter((e) => e.c > 0).sort((a, b) => b.c - a.c || a.u.localeCompare(b.u));
    const debtors = entries.filter((e) => e.c < 0).sort((a, b) => a.c - b.c || a.u.localeCompare(b.u));
    const transfers: Transfer[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i]!;
      const creditor = creditors[j]!;
      const amount = Math.min(-debtor.c, creditor.c);
      transfers.push({ from: debtor.u, to: creditor.u, amount: fromMinor(amount, digits) });
      debtor.c += amount;
      creditor.c -= amount;
      if (debtor.c === 0) i++;
      if (creditor.c === 0) j++;
    }
    return transfers;
  }

  /**
   * What `userId` should be nudged about: shared bills they are responsible
   * for that are due within `withinDays` (or overdue), and money they owe.
   */
  reminders(userId: string, householdId: string, options: { withinDays?: number } = {}): Reminder[] {
    const now = this.p.now();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + (options.withinDays ?? 3) * DAY).toISOString().slice(0, 10);
    const currency = this.currency(householdId);
    const result: Reminder[] = [];

    for (const bill of this.p.acl.visible<BillProps>(userId, householdId, 'bill')) {
      const { status, dueDate, shares } = bill.props;
      if (status !== 'unpaid' || !dueDate || !(userId in shares) || dueDate > horizon) continue;
      const kind: ReminderKind = dueDate < today ? 'bill_overdue' : 'bill_due';
      result.push({
        key: `${kind}:${bill.id}:${userId}`,
        kind,
        userId,
        amount: bill.props.amount,
        currency: bill.props.currency,
        billId: bill.id,
        label: bill.label,
        dueDate,
      });
    }
    for (const t of this.settleUp(userId, householdId)) {
      if (t.from !== userId) continue;
      result.push({ key: `debt:${userId}:${t.to}:${t.amount}`, kind: 'debt', userId, amount: t.amount, currency, to: t.to });
    }
    return result;
  }

  /** Report built only from what the actor can see — others' private spending never appears. */
  monthlyReport(actorId: string, householdId: string, month: string): MonthlyReport {
    const digits = currencyDigits(this.currency(householdId));
    const byCategory: Record<string, number> = {};
    let total = 0;
    const add = (category: string, amount: number) => {
      byCategory[category] = (byCategory[category] ?? 0) + toMinor(amount, digits);
      total += toMinor(amount, digits);
    };
    for (const tx of this.p.acl.visible<TransactionProps>(actorId, householdId, 'transaction')) {
      if (tx.props.kind === 'settlement' || !tx.props.date.startsWith(month)) continue;
      add(tx.props.category, tx.props.amount);
    }
    const bills = this.p.acl
      .visible<BillProps>(actorId, householdId, 'bill')
      .filter((b) => (b.props.dueDate ?? b.props.periodEnd ?? b.createdAt.toISOString()).startsWith(month));
    for (const bill of bills) add(bill.props.category, bill.props.amount);
    return {
      month,
      currency: this.currency(householdId),
      total: fromMinor(total, digits),
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, fromMinor(v, digits)])),
      bills: bills.map((b) => ({ id: b.id, label: b.label, amount: b.props.amount, status: b.props.status })),
    };
  }

  private assertCanSettleBill(actorId: string, bill: GraphNode<BillProps>): void {
    // Anyone sharing the bill can record that it was paid.
    if (actorId in bill.props.shares && this.p.acl.canRead(actorId, bill)) return;
    this.p.acl.assertWrite(actorId, bill);
  }

  private currency(householdId: string): string {
    return (this.p.graph.getNode(householdId)?.props.currency as string | undefined) ?? 'AUD';
  }
}

/** Even split in minor units; leftover units go to the first people so the total is exact. */
export function splitEvenly(amount: number, people: string[], digits = 2): Record<string, number> {
  if (people.length === 0) return {};
  return splitWeighted(amount, Object.fromEntries(people.map((p) => [p, 1])), digits);
}

export function splitWeighted(amount: number, weights: Record<string, number>, digits = 2): Record<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  if (totalWeight === 0) return {};
  const totalMinor = toMinor(amount, digits);
  const raw = entries.map(([u, w]) => ({ u, exact: (totalMinor * w) / totalWeight }));
  const floored = raw.map((r) => ({ ...r, c: Math.floor(r.exact) }));
  let remainder = totalMinor - floored.reduce((s, r) => s + r.c, 0);
  for (const r of [...floored].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (remainder <= 0) break;
    r.c += 1;
    remainder -= 1;
  }
  return Object.fromEntries(floored.map((r) => [r.u, fromMinor(r.c, digits)]));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
