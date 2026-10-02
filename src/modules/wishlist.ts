import type { GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export interface ProductProps extends Record<string, unknown> {
  url?: string;
  retailer?: string;
  currency: string;
  priceHistory: { price: number; at: string; source: string }[];
}

export interface WishProps extends Record<string, unknown> {
  /** Price when the item was saved. */
  savedPrice?: number;
  /** Optional price the user is waiting for. */
  targetPrice?: number;
  status: 'wanted' | 'purchased' | 'dropped';
}

export interface PriceAlert {
  wishId: string;
  ownerId: string;
  product: string;
  price: number;
  previous: number;
  reason: 'below_saved_price' | 'reached_target';
  message: string;
}

/** Per-member wishlists with price tracking. Wishes are private by default. */
export class Wishlist {
  constructor(private readonly p: Platform) {}

  addWish(
    actorId: string,
    householdId: string,
    input: { product: string; url?: string; retailer?: string; price?: number; targetPrice?: number; currency?: string },
  ): GraphNode<WishProps> {
    this.p.acl.assertCreate(actorId, householdId, 'shopping');
    const product =
      this.p.graph
        .findByType<ProductProps>(householdId, 'product')
        .find((n) => n.ownerId === actorId && n.label.toLowerCase() === input.product.toLowerCase()) ??
      this.p.graph.addNode<ProductProps>({
        type: 'product',
        householdId,
        domain: 'shopping',
        label: input.product,
        ownerId: actorId,
        visibility: 'private',
        props: { url: input.url, retailer: input.retailer, currency: input.currency ?? 'AUD', priceHistory: [] },
      });
    if (input.price !== undefined) this.appendPrice(product, input.price, 'user');
    const wish = this.p.graph.addNode<WishProps>({
      type: 'wish',
      householdId,
      domain: 'shopping',
      label: input.product,
      ownerId: actorId,
      visibility: 'private',
      props: { savedPrice: input.price, targetPrice: input.targetPrice, status: 'wanted' },
    });
    this.p.graph.link(wish.id, 'wishes_for', product.id);
    return wish;
  }

  /**
   * Fed by retailer / price-tracking integrations. Returns alerts for the
   * owners of wishes whose price dropped below what they saved or targeted.
   */
  recordPrice(productId: string, price: number, source = 'retailer'): PriceAlert[] {
    const product = this.p.graph.requireNode<ProductProps>(productId);
    this.appendPrice(product, price, source);
    const alerts: PriceAlert[] = [];
    for (const wish of this.p.graph.neighbors<WishProps>(productId, { relation: 'wishes_for', direction: 'in' })) {
      if (wish.props.status !== 'wanted' || !wish.ownerId) continue;
      const { targetPrice, savedPrice } = wish.props;
      const base = { wishId: wish.id, ownerId: wish.ownerId, product: product.label, price };
      if (targetPrice !== undefined && price <= targetPrice) {
        alerts.push({
          ...base,
          previous: targetPrice,
          reason: 'reached_target',
          message: `${product.label} is now ${price}, at or below your target of ${targetPrice}.`,
        });
      } else if (savedPrice !== undefined && price < savedPrice) {
        alerts.push({
          ...base,
          previous: savedPrice,
          reason: 'below_saved_price',
          message: `${product.label}: the current price (${price}) is lower than the price you saved (${savedPrice}).`,
        });
      }
    }
    return alerts;
  }

  wishes(actorId: string, householdId: string): GraphNode<WishProps>[] {
    return this.p.acl
      .visible<WishProps>(actorId, householdId, 'wish')
      .filter((w) => w.props.status === 'wanted');
  }

  lowestPrice(productId: string): number | undefined {
    const history = this.p.graph.requireNode<ProductProps>(productId).props.priceHistory;
    return history.length ? Math.min(...history.map((h) => h.price)) : undefined;
  }

  productOf(wishId: string): GraphNode<ProductProps> | undefined {
    return this.p.graph.neighbors<ProductProps>(wishId, { relation: 'wishes_for', direction: 'out' })[0];
  }

  private appendPrice(product: GraphNode<ProductProps>, price: number, source: string): void {
    this.p.graph.updateNode<ProductProps>(product.id, {
      priceHistory: [...product.props.priceHistory, { price, at: this.p.now().toISOString(), source }],
    });
  }
}
