import type { GraphNode } from '../graph/types.js';
import type { Delivery } from '../modules/delivery.js';
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
 * household-visible.
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
   * @param integrationId when the signal arrived through a connected
   *   integration, facts outside that integration's scopes are dropped.
   */
  ingest(actorId: string, householdId: string, signal: Signal, integrationId?: string): CaptureResult {
    const actions: string[] = [];
    const facts = this.extractor.extract(signal).filter((fact) => {
      if (!integrationId || !this.registry) return true;
      const allowed = this.registry.allows(integrationId, FACT_DOMAIN[fact.kind]);
      if (!allowed) actions.push(`Skipped ${fact.kind}: integration not permitted to write ${FACT_DOMAIN[fact.kind]}`);
      return allowed;
    });
    const created: GraphNode[] = [];

    let order: GraphNode | undefined;
    const receipt = facts.find((f): f is ReceiptFact => f.kind === 'receipt');
    if (receipt) {
      const result = this.connectReceipt(actorId, householdId, receipt, signal);
      order = result.order;
      created.push(...result.created);
      actions.push(
        `Recorded ${receipt.currency} ${receipt.total.toFixed(2)} purchase${receipt.retailer ? ` from ${receipt.retailer}` : ''}`,
      );
    }

    for (const fact of facts) {
      if (fact.kind === 'tracking') {
        const parcel = this.delivery.trackParcel(actorId, householdId, {
          trackingNumber: fact.trackingNumber,
          carrier: fact.carrier,
          recipientId: actorId,
          orderId: order?.id,
        });
        created.push(parcel);
        actions.push(`Tracking ${fact.carrier} parcel ${fact.trackingNumber}`);
      } else if (fact.kind === 'bill') {
        const bill = this.finance.recordBill(actorId, householdId, {
          category: fact.category,
          amount: fact.amount,
          currency: fact.currency,
          dueDate: fact.dueDate,
        });
        created.push(bill);
        const split = Object.keys(bill.props.shares).length;
        actions.push(
          `Added ${bill.label.toLowerCase()} (${fact.currency} ${fact.amount.toFixed(2)}${fact.dueDate ? `, due ${fact.dueDate}` : ''}) split between ${split}`,
        );
      }
    }
    return { facts, created, actions };
  }

  private connectReceipt(actorId: string, householdId: string, fact: ReceiptFact, signal: Signal) {
    const g = this.p.graph;
    const created: GraphNode[] = [];
    const isPrivate = { ownerId: actorId, visibility: 'private' as const };

    let retailer: GraphNode | undefined;
    if (fact.retailer) {
      retailer =
        g.findByLabel(householdId, 'retailer', fact.retailer) ??
        g.addNode({ type: 'retailer', householdId, domain: 'shopping', label: fact.retailer });
    }

    const order =
      (fact.orderNumber
        ? g.findByType(householdId, 'order').find((o) => o.props.orderNumber === fact.orderNumber)
        : undefined) ??
      g.addNode({
        type: 'order',
        householdId,
        domain: 'shopping',
        label: fact.orderNumber ? `Order ${fact.orderNumber}` : `Purchase${fact.retailer ? ` at ${fact.retailer}` : ''}`,
        props: { orderNumber: fact.orderNumber, total: fact.total, currency: fact.currency },
        ...isPrivate,
      });
    created.push(order);
    if (retailer) g.link(order.id, 'sold_by', retailer.id);

    const document = g.addNode({
      type: 'document',
      householdId,
      domain: 'documents',
      label: signal.subject ?? 'Receipt',
      props: { kind: 'receipt', source: signal.source, from: signal.from },
      ...isPrivate,
    });
    created.push(document);
    g.link(order.id, 'evidenced_by', document.id);

    const tx = this.finance.recordExpense(actorId, householdId, {
      description: order.label,
      amount: fact.total,
      currency: fact.currency,
      category: 'shopping',
      date: (signal.receivedAt ?? this.p.now()).toISOString().slice(0, 10),
      private: true,
    });
    created.push(tx);
    g.link(order.id, 'purchased_as', tx.id);
    g.link(tx.id, 'evidenced_by', document.id);

    return { order, created };
  }
}
