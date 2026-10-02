import type { GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export type ParcelStatus = 'expected' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';

export interface ParcelProps extends Record<string, unknown> {
  trackingNumber: string;
  carrier: string;
  status: ParcelStatus;
  expectedOn?: string;
  history: { status: ParcelStatus; at: string }[];
}

export interface ParcelView {
  parcel: GraphNode<ParcelProps>;
  recipient?: string;
  /** Present only when the viewer may see the order (orders are private by default). */
  order?: GraphNode;
  retailer?: string;
}

/** One place for every incoming parcel, linked to its order and recipient. */
export class Delivery {
  constructor(private readonly p: Platform) {}

  trackParcel(
    actorId: string,
    householdId: string,
    input: { trackingNumber: string; carrier: string; recipientId?: string; orderId?: string; expectedOn?: string },
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
        label: `${input.carrier} ${input.trackingNumber}`,
        ownerId: actorId,
        props: {
          trackingNumber: input.trackingNumber,
          carrier: input.carrier,
          status: 'expected',
          expectedOn: input.expectedOn,
          history: [{ status: 'expected', at: this.p.now().toISOString() }],
        },
      });
    this.p.graph.link(parcel.id, 'recipient', input.recipientId ?? actorId);
    if (input.orderId) this.p.graph.link(parcel.id, 'delivers', input.orderId);
    return parcel;
  }

  /** Called by delivery-provider integrations (or a user) as status changes. */
  updateStatus(actorId: string, parcelId: string, status: ParcelStatus): GraphNode<ParcelProps> {
    const parcel = this.p.graph.requireNode<ParcelProps>(parcelId);
    this.p.acl.assertWrite(actorId, parcel);
    return this.p.graph.updateNode<ParcelProps>(parcelId, {
      status,
      history: [...parcel.props.history, { status, at: this.p.now().toISOString() }],
    });
  }

  parcels(actorId: string, householdId: string, options: { includeDelivered?: boolean } = {}): ParcelView[] {
    return this.p.acl
      .visible<ParcelProps>(actorId, householdId, 'parcel')
      .filter((n) => options.includeDelivered || n.props.status !== 'delivered')
      .map((parcel) => {
        const recipient = this.p.graph.neighbors(parcel.id, { relation: 'recipient', direction: 'out' })[0];
        const order = this.p.graph
          .neighbors(parcel.id, { relation: 'delivers', direction: 'out' })
          .find((o) => this.p.acl.canRead(actorId, o));
        const retailer = order
          ? this.p.graph.neighbors(order.id, { relation: 'sold_by', direction: 'out' })[0]?.label
          : undefined;
        return { parcel, recipient: recipient?.label, order, retailer };
      });
  }
}
