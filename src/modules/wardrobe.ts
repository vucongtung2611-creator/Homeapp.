import type { GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export type GarmentCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';

export interface GarmentProps extends Record<string, unknown> {
  category: GarmentCategory;
  colour: string;
  brand?: string;
  size?: string;
  price?: number;
  purchasedOn?: string;
  /** 1 = light/summer, 2 = mid, 3 = warm/winter. */
  warmth: 1 | 2 | 3;
  occasions: string[];
  wears: string[]; // ISO dates
  condition?: 'new' | 'good' | 'worn';
}

export interface Outfit {
  pieces: GraphNode<GarmentProps>[];
  reason: string;
}

const DAY = 86_400_000;

/** Personal digital wardrobe — private to its owner unless shared. */
export class Wardrobe {
  constructor(private readonly p: Platform) {}

  addGarment(
    actorId: string,
    householdId: string,
    input: { name: string; category: GarmentCategory; colour: string } & Partial<Omit<GarmentProps, 'wears'>>,
  ): GraphNode<GarmentProps> {
    this.p.acl.assertCreate(actorId, householdId, 'wardrobe');
    const { name, ...rest } = input;
    const garment = this.p.graph.addNode<GarmentProps>({
      type: 'garment',
      householdId,
      domain: 'wardrobe',
      label: name,
      ownerId: actorId,
      visibility: 'private',
      props: { warmth: 2, occasions: ['casual'], ...rest, wears: [] },
    });
    this.p.graph.link(actorId, 'owns', garment.id);
    return garment;
  }

  wear(actorId: string, garmentIds: string[], on: Date = this.p.now()): void {
    const date = on.toISOString().slice(0, 10);
    const pieces = garmentIds.map((id) => this.p.graph.requireNode<GarmentProps>(id));
    for (const g of pieces) {
      this.p.acl.assertWrite(actorId, g);
      this.p.graph.updateNode<GarmentProps>(g.id, { wears: [...g.props.wears, date] });
    }
    // Remember combinations so the stylist can learn what goes together.
    for (const a of pieces) for (const b of pieces) if (a.id < b.id) this.p.graph.link(a.id, 'worn_with', b.id);
  }

  garments(actorId: string, householdId: string): GraphNode<GarmentProps>[] {
    return this.p.acl
      .visible<GarmentProps>(actorId, householdId, 'garment')
      .filter((g) => g.ownerId === actorId || g.sharedWith.includes(actorId));
  }

  /** Clothes not worn within `days` (or never worn and older than that). */
  unused(actorId: string, householdId: string, days = 180): GraphNode<GarmentProps>[] {
    const cutoff = this.p.now().getTime() - days * DAY;
    return this.garments(actorId, householdId).filter((g) => {
      const last = g.props.wears.at(-1);
      const reference = last ? Date.parse(last) : g.createdAt.getTime();
      return reference < cutoff;
    });
  }

  suggestOutfit(
    actorId: string,
    householdId: string,
    context: { occasion?: string; temperatureC?: number } = {},
  ): Outfit | undefined {
    const occasion = context.occasion ?? 'casual';
    const warmth = context.temperatureC === undefined ? 2 : context.temperatureC < 12 ? 3 : context.temperatureC > 24 ? 1 : 2;
    const own = this.garments(actorId, householdId).filter((g) => g.ownerId === actorId);
    const pick = (category: GarmentCategory) =>
      own
        .filter((g) => g.props.category === category && g.props.occasions.includes(occasion))
        .sort(
          (a, b) =>
            Math.abs(a.props.warmth - warmth) - Math.abs(b.props.warmth - warmth) ||
            (a.props.wears.at(-1) ?? '').localeCompare(b.props.wears.at(-1) ?? ''),
        )[0];

    const dress = pick('dress');
    const top = pick('top');
    const bottom = pick('bottom');
    const base = top && bottom ? [top, bottom] : dress ? [dress] : undefined;
    if (!base) return undefined;
    const pieces = [...base];
    const shoes = pick('shoes');
    if (shoes) pieces.push(shoes);
    if (warmth === 3) {
      const coat = pick('outerwear');
      if (coat) pieces.push(coat);
    }
    const temp = context.temperatureC !== undefined ? ` at ${context.temperatureC}°C` : '';
    return { pieces, reason: `${occasion} outfit${temp}, favouring pieces you haven't worn recently` };
  }
}
