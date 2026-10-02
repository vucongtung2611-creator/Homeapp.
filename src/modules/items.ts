import type { Domain, GraphNode } from '../graph/types.js';
import { PermissionDeniedError } from '../permissions/AccessControl.js';
import type { Platform } from '../platform.js';

/**
 * A "space" is a room of the app that holds things: the Library today,
 * later the kitchen, the wardrobe, the movie shelf. They all share one item
 * shape; what differs is the `attributes` each space cares about
 * (expiry for food, size for clothes, rating for films).
 */
export type Space = 'library' | 'kitchen' | 'wardrobe' | 'movies';

export type ItemKind = 'note' | 'document' | 'photo' | 'link';

export interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

export interface HouseItemProps extends Record<string, unknown> {
  space: Space;
  kind: ItemKind;
  body?: string;
  tags: string[];
  attachments: Attachment[];
  /** Space-specific fields, e.g. { expiresOn } in the kitchen. */
  attributes: Record<string, unknown>;
  /** Created as sample data for a new household. */
  sample?: boolean;
}

export interface ItemInput {
  space?: Space;
  kind: ItemKind;
  title: string;
  body?: string;
  tags?: string[];
  attachments?: Attachment[];
  attributes?: Record<string, unknown>;
  /** Private items are visible only to their creator (and explicit shares). */
  private?: boolean;
  sample?: boolean;
}

const SPACE_DOMAIN: Record<Space, Domain> = {
  library: 'library',
  kitchen: 'kitchen',
  wardrobe: 'wardrobe',
  movies: 'library',
};

export const MAX_TAGS = 12;

/** Lower-case and strip Vietnamese diacritics so "hoa don" finds "Hóa đơn". */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function normaliseTags(tags: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 30);
    const key = foldText(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Things kept in the household: notes, documents, photos — one shape for every space. */
export class Items {
  constructor(private readonly p: Platform) {}

  create(actorId: string, householdId: string, input: ItemInput): GraphNode<HouseItemProps> {
    const space = input.space ?? 'library';
    const domain = SPACE_DOMAIN[space];
    this.p.acl.assertCreate(actorId, householdId, domain);
    return this.p.graph.addNode<HouseItemProps>({
      type: 'item',
      householdId,
      domain,
      label: input.title.trim() || 'Untitled',
      ownerId: actorId,
      visibility: input.private ? 'private' : 'household',
      props: {
        space,
        kind: input.kind,
        body: input.body,
        tags: normaliseTags(input.tags),
        attachments: input.attachments ?? [],
        attributes: input.attributes ?? {},
        sample: input.sample || undefined,
      },
    });
  }

  update(
    actorId: string,
    itemId: string,
    patch: Partial<Pick<ItemInput, 'title' | 'body' | 'tags' | 'attachments' | 'attributes' | 'private'>>,
  ): GraphNode<HouseItemProps> {
    const item = this.require(itemId);
    this.p.acl.assertWrite(actorId, item);
    if (patch.private !== undefined && (patch.private ? 'private' : 'household') !== item.visibility) {
      // Only the creator decides who sees an item.
      this.p.setVisibility(actorId, itemId, patch.private ? 'private' : 'household', false);
    }
    const props: Partial<HouseItemProps> = {};
    if (patch.body !== undefined) props.body = patch.body;
    if (patch.tags !== undefined) props.tags = normaliseTags(patch.tags);
    if (patch.attachments !== undefined) props.attachments = patch.attachments;
    if (patch.attributes !== undefined) props.attributes = patch.attributes;
    props.sample = undefined; // once edited, it's theirs
    return this.p.graph.updateNode<HouseItemProps>(itemId, props, patch.title?.trim() || undefined);
  }

  remove(actorId: string, itemId: string): GraphNode<HouseItemProps> {
    const item = this.require(itemId);
    const householdOwner = this.p.acl.roleOf(actorId, item.householdId) === 'owner';
    if (item.ownerId !== actorId && !(householdOwner && item.visibility === 'household')) {
      throw new PermissionDeniedError(actorId, 'delete', itemId);
    }
    this.p.graph.removeNode(itemId);
    return item;
  }

  get(actorId: string, itemId: string): GraphNode<HouseItemProps> {
    const item = this.require(itemId);
    this.p.acl.assertRead(actorId, item);
    return item;
  }

  /** Search by words (accent-insensitive, all must match) and/or tag. Newest first. */
  list(
    actorId: string,
    householdId: string,
    query: { space?: Space; q?: string; tag?: string; kind?: ItemKind } = {},
  ): GraphNode<HouseItemProps>[] {
    const words = foldText(query.q ?? '').split(/\s+/).filter(Boolean);
    const tag = query.tag ? foldText(query.tag) : undefined;
    return this.p.acl
      .visible<HouseItemProps>(actorId, householdId, 'item')
      .filter((n) => n.props.space === (query.space ?? 'library'))
      .filter((n) => !query.kind || n.props.kind === query.kind)
      .filter((n) => !tag || n.props.tags.some((t) => foldText(t) === tag))
      .filter((n) => {
        if (words.length === 0) return true;
        const haystack = foldText(
          [n.label, n.props.body ?? '', n.props.tags.join(' '), n.props.attachments.map((a) => a.name).join(' ')].join(' '),
        );
        return words.every((w) => haystack.includes(w));
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** Tags in use with counts, for the filter chips. */
  tags(actorId: string, householdId: string, space: Space = 'library'): { tag: string; count: number }[] {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const item of this.list(actorId, householdId, { space })) {
      for (const tag of item.props.tags) {
        const key = foldText(tag);
        const entry = counts.get(key) ?? { tag, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Every item that references a file — used to decide who may download it. */
  referencing(householdId: string, fileId: string): GraphNode<HouseItemProps>[] {
    return this.p.graph
      .findByType<HouseItemProps>(householdId, 'item')
      .filter((n) => n.props.attachments?.some((a) => a.fileId === fileId));
  }

  private require(itemId: string): GraphNode<HouseItemProps> {
    const item = this.p.graph.requireNode<HouseItemProps>(itemId);
    if (item.type !== 'item' || !item.props.space) throw new Error(`${itemId} is not a library item`);
    return item;
  }
}
