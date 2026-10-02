import type { GraphNode } from '../graph/types.js';
import type { BillCategory } from '../integrations/understand.js';
import type { Platform } from '../platform.js';
import type { Coordination } from './tasks.js';

export interface BillProps extends Record<string, unknown> {
  category: BillCategory | string;
  amount: number;
  currency: string;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  /** userId -> amount owed. */
  shares: Record<string, number>;
  paid: string[];
  status: 'unpaid' | 'partially_paid' | 'paid';
}

export interface TransactionProps extends Record<string, unknown> {
  amount: number;
  currency: string;
  category: string;
  date: string; // ISO date
  paidBy: string;
  /** Who the expense is shared between; empty/one entry means personal. */
  participants: string[];
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface MonthlyReport {
  month: string;
  currency: string;
  total: number;
  byCategory: Record<string, number>;
  bills: { id: string; label: string; amount: number; status: BillProps['status'] }[];
}

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;

/**
 * Household finance: bills, shared expenses and settle-up. Members can share
 * the *outcome* (who owes whom) without exposing their personal transactions.
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
      dueDate?: string;
      periodStart?: string;
      periodEnd?: string;
      responsible?: string[];
      label?: string;
    },
  ): GraphNode<BillProps> {
    this.p.acl.assertCreate(actorId, householdId, 'finance');
    const responsible = input.responsible ?? this.p.residents(householdId).map((r) => r.id);
    const bill = this.p.graph.addNode<BillProps>({
      type: 'bill',
      householdId,
      domain: 'finance',
      label: input.label ?? `${capitalise(input.category)} bill`,
      ownerId: actorId,
      props: {
        category: input.category,
        amount: input.amount,
        currency: input.currency ?? this.currency(householdId),
        dueDate: input.dueDate,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        shares: splitEvenly(input.amount, responsible),
        paid: [],
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
    const people = weights ? Object.keys(weights) : Object.keys(bill.props.shares);
    const shares = weights ? splitWeighted(bill.props.amount, weights) : splitEvenly(bill.props.amount, people);
    this.p.graph.updateNode<BillProps>(billId, { shares });
    return shares;
  }

  markPaid(actorId: string, billId: string, userId: string = actorId): GraphNode<BillProps> {
    const bill = this.p.graph.requireNode<BillProps>(billId);
    // Anyone responsible can mark their own share paid; otherwise need write.
    if (!(userId === actorId && userId in bill.props.shares)) this.p.acl.assertWrite(actorId, bill);
    const paid = [...new Set([...bill.props.paid, userId])];
    const owing = Object.keys(bill.props.shares);
    const status = owing.every((u) => paid.includes(u)) ? 'paid' : 'partially_paid';
    this.p.graph.link(bill.id, 'paid_by', userId);
    return this.p.graph.updateNode<BillProps>(billId, { paid, status });
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
      participants?: string[];
      /** Personal spending stays private unless shared explicitly. */
      private?: boolean;
    },
  ): GraphNode<TransactionProps> {
    this.p.acl.assertCreate(actorId, householdId, 'finance');
    const paidBy = input.paidBy ?? actorId;
    const participants = input.participants ?? [paidBy];
    const isPrivate = input.private ?? participants.length <= 1;
    const tx = this.p.graph.addNode<TransactionProps>({
      type: 'transaction',
      householdId,
      domain: 'finance',
      label: input.description,
      ownerId: actorId,
      visibility: isPrivate ? 'private' : 'household',
      props: {
        amount: input.amount,
        currency: input.currency ?? this.currency(householdId),
        category: input.category,
        date: input.date ?? this.p.now().toISOString().slice(0, 10),
        paidBy,
        participants,
      },
    });
    this.p.graph.link(tx.id, 'paid_by', paidBy);
    return tx;
  }

  /** Net position per member from shared expenses (positive = is owed money). */
  balances(actorId: string, householdId: string): Record<string, number> {
    const net = new Map<string, number>();
    for (const tx of this.p.acl.visible<TransactionProps>(actorId, householdId, 'transaction')) {
      const { participants, paidBy, amount } = tx.props;
      if (participants.length < 2) continue;
      const shares = splitEvenly(amount, participants);
      net.set(paidBy, (net.get(paidBy) ?? 0) + cents(amount));
      for (const [user, share] of Object.entries(shares)) net.set(user, (net.get(user) ?? 0) - cents(share));
    }
    return Object.fromEntries([...net].map(([u, c]) => [u, dollars(c)]));
  }

  /** Minimal set of transfers that settles all shared expenses. */
  settleUp(actorId: string, householdId: string): Transfer[] {
    const entries = Object.entries(this.balances(actorId, householdId)).map(([u, a]) => ({ u, c: cents(a) }));
    const creditors = entries.filter((e) => e.c > 0).sort((a, b) => b.c - a.c);
    const debtors = entries.filter((e) => e.c < 0).sort((a, b) => a.c - b.c);
    const transfers: Transfer[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i]!;
      const creditor = creditors[j]!;
      const amount = Math.min(-debtor.c, creditor.c);
      transfers.push({ from: debtor.u, to: creditor.u, amount: dollars(amount) });
      debtor.c += amount;
      creditor.c -= amount;
      if (debtor.c === 0) i++;
      if (creditor.c === 0) j++;
    }
    return transfers;
  }

  /** Report built only from what the actor can see — others' private spending never appears. */
  monthlyReport(actorId: string, householdId: string, month: string): MonthlyReport {
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const tx of this.p.acl.visible<TransactionProps>(actorId, householdId, 'transaction')) {
      if (!tx.props.date.startsWith(month)) continue;
      byCategory[tx.props.category] = (byCategory[tx.props.category] ?? 0) + cents(tx.props.amount);
      total += cents(tx.props.amount);
    }
    const bills = this.p.acl
      .visible<BillProps>(actorId, householdId, 'bill')
      .filter((b) => (b.props.dueDate ?? b.props.periodEnd ?? b.createdAt.toISOString()).startsWith(month));
    for (const bill of bills) {
      byCategory[bill.props.category] = (byCategory[bill.props.category] ?? 0) + cents(bill.props.amount);
      total += cents(bill.props.amount);
    }
    return {
      month,
      currency: this.currency(householdId),
      total: dollars(total),
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, dollars(v)])),
      bills: bills.map((b) => ({ id: b.id, label: b.label, amount: b.props.amount, status: b.props.status })),
    };
  }

  private currency(householdId: string): string {
    return (this.p.graph.getNode(householdId)?.props.currency as string | undefined) ?? 'AUD';
  }
}

/** Even split in cents; leftover cents go to the first people so the total is exact. */
export function splitEvenly(amount: number, people: string[]): Record<string, number> {
  if (people.length === 0) return {};
  return splitWeighted(amount, Object.fromEntries(people.map((p) => [p, 1])));
}

export function splitWeighted(amount: number, weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  if (totalWeight === 0) return {};
  const totalCents = cents(amount);
  const raw = entries.map(([u, w]) => ({ u, exact: (totalCents * w) / totalWeight }));
  const floored = raw.map((r) => ({ ...r, c: Math.floor(r.exact) }));
  let remainder = totalCents - floored.reduce((s, r) => s + r.c, 0);
  for (const r of [...floored].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (remainder <= 0) break;
    r.c += 1;
    remainder -= 1;
  }
  return Object.fromEntries(floored.map((r) => [r.u, dollars(r.c)]));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
