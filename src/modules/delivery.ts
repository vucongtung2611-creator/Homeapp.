import type { GraphNode } from '../graph/types.js';
import { PermissionDeniedError } from '../permissions/AccessControl.js';
import type { Platform } from '../platform.js';

export type ParcelStatus = 'expected' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';

export interface ParcelProps extends Record<string, unknown> {
  trackingNumber: string;
  carrier: string;
  status: ParcelStatus;
  expectedOn?: string;
  /**
   * What housemates see instead of the contents, e.g. "Đồ riêng".
   * The real description lives on the (private) order.
   */
  publicLabel?: string;
  history: { status: ParcelStatus; at: string; by?: string }[];
}

export interface OrderProps extends Record<string, unknown> {
  orderNumber?: string;
  description?: string;
  total?: number;
  currency?: string;
}

export interface ParcelView {
  parcel: GraphNode<ParcelProps>;
  recipient?: string;
  /** Present only when the viewer may see the order (orders are private by default). */
  order?: GraphNode<OrderProps>;
  retailer?: string;
}

/**
 * Field-level projection of a parcel for one viewer. Everyone in the
 * household sees that a parcel exists, who it is for and its status; only the
 * recipient (or people the order was shared with) see tracking number,
 * retailer and contents.
 */
export interface ParcelSummary {
  id: string;
  label: string;
  carrier: string;
  status: ParcelStatus;
  expectedOn?: string;
  recipientId?: string;
  recipientName?: string;
  isMine: boolean;
  trackingNumber?: string;
  publicLabel?: string;
  order?: {
    id: string;
    label: string;
    description?: string;
    retailer?: string;
    total?: number;
    currency?: string;
    sharedWithHousehold: boolean;
    canShare: boolean;
  };
  history: ParcelProps['history'];
}

/** One place for every incoming parcel, linked to its order and recipient. */
export class Delivery {
  constructor(private readonly p: Platform) {}

  trackParcel(
    actorId: string,
    householdId: string,
    input: {
      trackingNumber: string;
      carrier: string;
      recipientId?: string;
      orderId?: string;
      expectedOn?: string;
      publicLabel?: string;
    },
  ): GraphNode<ParcelProps> {
    this.p.acl.assertCreate(actorId, householdId, 'delivery');
    const existing = this.p.graph
      .findByType<ParcelProps>(householdId, 'parcel')
      .find((n) => n.props.trackingNumber === input.trackingNumber);
    const parcel =
      existing ??
      this.p.graph.addNode<ParcelProps>({
        type: 'parcel',
        householdId,
        domain: 'delivery',
        // Never the contents: the node is visible to the whole household.
        label: `${input.carrier} parcel`,
        ownerId: actorId,
        props: {
          trackingNumber: input.trackingNumber,
          carrier: input.carrier,
          status: 'expected',
          expectedOn: input.expectedOn,
          publicLabel: input.publicLabel?.trim() || undefined,
          history: [{ status: 'expected', at: this.p.now().toISOString(), by: actorId }],
        },
      });
    if (existing && input.publicLabel !== undefined) this.setPublicLabel(actorId, parcel.id, input.publicLabel);
    this.p.graph.link(parcel.id, 'recipient', input.recipientId ?? actorId);
    if (input.orderId) this.p.graph.link(parcel.id, 'delivers', input.orderId);
    return parcel;
  }

  /** Called by delivery-provider integrations (or a member, e.g. "An received it"). */
  updateStatus(actorId: string, parcelId: string, status: ParcelStatus): GraphNode<ParcelProps> {
    const parcel = this.p.graph.requireNode<ParcelProps>(parcelId);
    this.p.acl.assertWrite(actorId, parcel);
    return this.p.graph.updateNode<ParcelProps>(parcelId, {
      status,
      history: [...parcel.props.history, { status, at: this.p.now().toISOString(), by: actorId }],
    });
  }

  /** The label housemates see ("Đồ riêng", "Quà 🤫"). Only the recipient or creator may set it. */
  setPublicLabel(actorId: string, parcelId: string, label: string): GraphNode<ParcelProps> {
    const parcel = this.p.graph.requireNode<ParcelProps>(parcelId);
    if (!this.isMine(actorId, parcel)) throw new PermissionDeniedError(actorId, 'relabel', parcelId);
    return this.p.graph.updateNode<ParcelProps>(parcelId, { publicLabel: label.trim() || undefined });
  }

  /** One-tap "share this order with the household" (and back to private). */
  shareOrder(actorId: string, orderId: string, shared: boolean): GraphNode<OrderProps> {
    const order = this.p.graph.requireNode<OrderProps>(orderId);
    if (order.type !== 'order') throw new Error(`${orderId} is not an order`);
    this.p.setVisibility(actorId, orderId, shared ? 'household' : 'private');
    return order;
  }

  removeParcel(actorId: string, parcelId: string): void {
    const parcel = this.p.graph.requireNode<ParcelProps>(parcelId);
    if (!this.isMine(actorId, parcel)) this.p.acl.assertWrite(actorId, parcel);
    this.p.graph.removeNode(parcelId);
  }

  parcels(actorId: string, householdId: string, options: { includeDelivered?: boolean } = {}): ParcelView[] {
    return this.p.acl
      .visible<ParcelProps>(actorId, householdId, 'parcel')
      .filter((n) => options.includeDelivered || n.props.status !== 'delivered')
      .map((parcel) => {
        const recipient = this.recipientOf(parcel);
        const order = this.orderOf(parcel, actorId);
        const retailer = order
          ? this.p.graph.neighbors(order.id, { relation: 'sold_by', direction: 'out' })[0]?.label
          : undefined;
        return { parcel, recipient: recipient?.label, order, retailer };
      });
  }

  /** Permission- and field-filtered parcels, safe to send to any member's device. */
  summaries(actorId: string, householdId: string, options: { includeDelivered?: boolean } = {}): ParcelSummary[] {
    return this.parcels(actorId, householdId, options).map(({ parcel, order, retailer }) => {
      const recipient = this.recipientOf(parcel);
      const mine = this.isMine(actorId, parcel);
      const description = order?.props.description ?? order?.label;
      const fallback = `${parcel.props.carrier} parcel`;
      return {
        id: parcel.id,
        // What this viewer sees as the headline.
        label: mine || order ? (description ?? parcel.props.publicLabel ?? fallback) : (parcel.props.publicLabel ?? fallback),
        carrier: parcel.props.carrier,
        status: parcel.props.status,
        expectedOn: parcel.props.expectedOn,
        recipientId: recipient?.id,
        recipientName: recipient?.label,
        isMine: mine,
        trackingNumber: mine || order ? parcel.props.trackingNumber : undefined,
        publicLabel: parcel.props.publicLabel,
        order: order
          ? {
              id: order.id,
              label: order.label,
              description: order.props.description,
              retailer,
              total: order.props.total,
              currency: order.props.currency,
              sharedWithHousehold: order.visibility === 'household',
              canShare: order.ownerId === actorId,
            }
          : undefined,
        history: parcel.props.history,
      };
    });
  }

  private recipientOf(parcel: GraphNode): GraphNode | undefined {
    return this.p.graph.neighbors(parcel.id, { relation: 'recipient', direction: 'out' })[0];
  }

  private orderOf(parcel: GraphNode, actorId: string): GraphNode<OrderProps> | undefined {
    return this.p.graph
      .neighbors<OrderProps>(parcel.id, { relation: 'delivers', direction: 'out' })
      .find((o) => this.p.acl.canRead(actorId, o));
  }

  private isMine(actorId: string, parcel: GraphNode): boolean {
    return parcel.ownerId === actorId || this.recipientOf(parcel)?.id === actorId;
  }
}
