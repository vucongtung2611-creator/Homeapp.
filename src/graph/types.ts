/**
 * Household Graph vocabulary.
 *
 * Every piece of household information is a node; meaning comes from the
 * relations between nodes. A single real-world thing (e.g. "milk") can be
 * reached from kitchen, shopping, finance and delivery at the same time.
 */

export type NodeType =
  | 'home'
  | 'person'
  | 'room'
  | 'item' // a physical thing: food, appliance, asset
  | 'task'
  | 'event'
  | 'transaction'
  | 'document' // receipt, warranty, contract, photo
  | 'service'
  | 'integration'
  | 'recipe'
  | 'shopping_item'
  | 'order'
  | 'parcel'
  | 'retailer'
  | 'product'
  | 'bill'
  | 'issue'
  | 'garment'
  | 'wish';

/**
 * Data domains. Permissions are granted per domain, so a property manager can
 * be given `maintenance` without ever touching `finance` or `wardrobe`.
 */
export type Domain =
  | 'core' // home, rooms, people directory
  | 'kitchen'
  | 'finance'
  | 'delivery'
  | 'shopping'
  | 'maintenance'
  | 'wardrobe'
  | 'calendar'
  | 'communication'
  | 'documents';

export const ALL_DOMAINS: readonly Domain[] = [
  'core',
  'kitchen',
  'finance',
  'delivery',
  'shopping',
  'maintenance',
  'wardrobe',
  'calendar',
  'communication',
  'documents',
];

/**
 * - `household`: governed by the viewer's role policy for the node's domain.
 * - `private`: only the owner and users explicitly listed in `sharedWith`.
 */
export type Visibility = 'household' | 'private';

export type Relation =
  | 'member_of'
  | 'located_in'
  | 'contains'
  | 'owns'
  | 'uses_ingredient'
  | 'needed_for'
  | 'purchased_as'
  | 'evidenced_by'
  | 'sold_by'
  | 'part_of'
  | 'delivers'
  | 'recipient'
  | 'paid_by'
  | 'responsible'
  | 'assigned_to'
  | 'reported_by'
  | 'about'
  | 'wishes_for'
  | 'worn_with'
  | 'attending'
  | 'linked_to';

export type Props = Record<string, unknown>;

export interface GraphNode<P extends Props = Props> {
  readonly id: string;
  readonly type: NodeType;
  readonly householdId: string;
  readonly domain: Domain;
  label: string;
  props: P;
  /** User who owns the node (creator by default). */
  ownerId?: string;
  visibility: Visibility;
  /** Explicit per-user grants for private nodes. */
  sharedWith: string[];
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: Relation;
  readonly createdAt: Date;
  props?: Props;
}

export interface NewNode<P extends Props = Props> {
  id?: string;
  type: NodeType;
  householdId: string;
  domain: Domain;
  label: string;
  props?: P;
  ownerId?: string;
  visibility?: Visibility;
  sharedWith?: string[];
}
