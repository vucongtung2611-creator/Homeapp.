import type { GraphNode } from '../graph/types.js';
import type { Delivery, OrderProps } from '../modules/delivery.js';
import type { Finance } from '../modules/finance.js';
import type { Platform } from '../platform.js';
import type { IntegrationRegistry } from './registry.js';
import { RuleBasedExtractor, type Extractor, type Fact, type ReceiptFact, type Signal } from './understand.js';

export interface CaptureResult {
  facts: Fact[];
  created: GraphNode[];
  /** Human-readable summary of what the platform did, for the activity feed. */
  actions: string[];
}

const FACT_DOMAIN = { tracking: 'delivery', receipt: 'finance', bill: 'finance' } as const;

/**
 * Capture → Understand → Connect → Act.
 *
 * Information enters once (an email, a bank feed, a photo), is understood
 * into facts, connected to the household graph, and turned into actions
 * (a parcel to watch, a bill to split, a task to do).
 *
 * Privacy default: anything captured from a member's personal inbox (orders,
 * receipts, purchases) is private to that member. Only what the household
 * genuinely shares — a parcel arriving at the door, a utility bill — is
 * household-visible. Only costs explicitly marked shared are split.
 */
export class CapturePipeline {
  constructor(
    private readonly p: Platform,
    private readonly delivery: Delivery,
    private readonly finance: Finance,
    private readonly registry?: IntegrationRegistry,
    private readonly extractor: Extractor = new RuleBasedExtractor(),
  ) {}

  /**
   * Extract facts from a raw signal and apply them.
   * @param integrationId when the signal arrived through a connected
   *   integration, facts outside that integration's scopes are dropped.
   */
  ingest(actorId: string, householdId: string, signal: Signal, integrationId?: string): CaptureResult {
    const skipped: string[] = [];
    const facts = this.extractor.extract(signal).filter((fact) => {
      if (!integrationId || !this.registry) return true;
      const allowed = this.registry.allows(integrationId, FACT_DOMAIN[fact.kind]);
      if (!allowed) skipped.push(`Skipped ${fact.kind}: integration not permitted to write ${FACT_DOMAIN[fact.kind]}`);
      return allowed;
    });
    const result = this.apply(actorId, householdId, facts, signal);
    return { ...result, actions: [...skipped, ...result.actions] };
  }

  /**
   * Connect + Act for facts that are already understood — either straight from
   * the extractor, or reviewed and corrected by the user before saving.
   */
  apply(actorId: string, householdId: string, facts: Fact[], source: Partial<Signal> = {}): CaptureResult {
    const created: GraphNode[] = [];
    const actions: string[] = [];

    let order: GraphNode | undefined;
    const receipt = facts.find((f): f is ReceiptFact => f.kind === 'receipt');
    if (receipt) {
      const result = this.recordPurchase(actorId, householdId, receipt, source);
      order = result.order;
      created.push(result.order, result.document, result.transaction);
      actions.push(
        `Recorded ${receipt.currency} ${receipt.total} purchase${receipt.retailer ? ` from ${receipt.retailer}` : ''}` +
          (receipt.shared ? ' (shared)' : ''),
      );
    }

    for (const fact of facts) {
      if (fact.kind === 'tracking') {
        const parcel = this.delivery.trackParcel(actorId, householdId, {
          trackingNumber: fact.trackingNumber,
          carrier: fact.carrier,
          recipientId: actorId,
          orderId: order?.id,
          expectedOn: fact.expectedOn,
          publicLabel: fact.publicLabel,
        });
        created.push(parcel);
        actions.push(`Tracking ${fact.carrier} parcel ${fact.trackingNumber}`);
      } else if (fact.kind === 'bill') {
        const bill = this.finance.recordBill(actorId, householdId, {
          category: fact.category,
          amount: fact.amount,
          currency: fact.currency,
          provider: fact.provider,
          dueDate: fact.dueDate,
          periodStart: fact.periodStart,
          periodEnd: fact.periodEnd,
          shared: fact.shared,
          responsible: fact.responsible,
        });
        created.push(bill);
        const split = Object.keys(bill.props.shares).length;
        actions.push(
          `Added ${bill.label.toLowerCase()} (${fact.currency} ${fact.amount}${fact.dueDate ? `, due ${fact.dueDate}` : ''})` +
            (bill.props.shared ? ` split between ${split}` : ' (personal)'),
        );
      }
    }
    return { facts, created, actions };
  }

  /**
   * A purchase becomes order + receipt + transaction, all private to the buyer
   * unless the expense is marked shared (then only the transaction is shared;
   * the order can be shared separately with one tap).
   */
  recordPurchase(actorId: string, householdId: string, fact: ReceiptFact, source: Partial<Signal> = {}) {
    const g = this.p.graph;
    const isPrivate = { ownerId: actorId, visibility: 'private' as const };

    let retailer: GraphNode | undefined;
    if (fact.retailer) {
      this.p.acl.assertCreate(actorId, householdId, 'shopping');
      retailer =
        g.findByLabel(householdId, 'retailer', fact.retailer) ??
        g.addNode({ type: 'retailer', householdId, domain: 'shopping', label: fact.retailer });
    }

    const existing = fact.orderNumber
      ? g.findByType<OrderProps>(householdId, 'order').find((o) => o.props.orderNumber === fact.orderNumber && o.ownerId === actorId)
      : undefined;
    const order =
      existing ??
      g.addNode<OrderProps>({
        type: 'order',
        householdId,
        domain: 'shopping',
        label: fact.orderNumber ? `Order ${fact.orderNumber}` : `Purchase${fact.retailer ? ` at ${fact.retailer}` : ''}`,
        props: { orderNumber: fact.orderNumber, description: fact.description, total: fact.total, currency: fact.currency },
        ...isPrivate,
      });
    if (retailer) g.link(order.id, 'sold_by', retailer.id);

    const document = g.addNode({
      type: 'document',
      householdId,
      domain: 'documents',
      label: source.subject ?? 'Receipt',
      props: { kind: 'receipt', source: source.source ?? 'manual', from: source.from },
      ...isPrivate,
    });
    g.link(order.id, 'evidenced_by', document.id);

    const transaction = this.finance.recordExpense(actorId, householdId, {
      description: fact.description ?? (fact.retailer ? `${fact.retailer}` : order.label),
      amount: fact.total,
      currency: fact.currency,
      category: fact.category ?? 'shopping',
      date: fact.date ?? (source.receivedAt ?? this.p.now()).toISOString().slice(0, 10),
      shared: fact.shared ?? false,
      participants: fact.participants,
    });
    g.link(order.id, 'purchased_as', transaction.id);
    g.link(transaction.id, 'evidenced_by', document.id);

    return { order, document, transaction };
  }
}
