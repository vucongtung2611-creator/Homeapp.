import type { HomeApp } from '../src/index.js';
import { samplesFor } from './samples.js';
import { shelfSamples, type ShelfSample } from './shelf-samples.js';

/** Sample content so a brand-new home isn't empty. Everything is marked `sample` and can be cleared in one tap. */
export function seedSamples(app: HomeApp, householdId: string, ownerId: string, now: Date, locale = 'en'): void {
  const content = samplesFor(locale);
  const currency = String(app.platform.graph.requireNode(householdId).props.currency ?? 'USD');
  const wholeUnits = ['VND', 'JPY', 'KRW'].includes(currency);
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  for (const note of content.notes) {
    app.items.create(ownerId, householdId, { kind: 'note', ...note, sample: true });
  }
  seedShelf(app, householdId, ownerId, now, locale);
  const bill = app.finance.recordBill(ownerId, householdId, {
    category: 'electricity',
    label: content.bill.label,
    amount: currency === 'VND' ? 850_000 : wholeUnits ? 12_000 : 142.5,
    provider: currency === 'VND' ? content.bill.provider.VND : content.bill.provider.default,
    dueDate: iso(5),
    periodStart: iso(-35),
    periodEnd: iso(-5),
  });
  app.platform.graph.updateNode(bill.id, { sample: true });
}

export function clearSamples(app: HomeApp, householdId: string): number {
  const graph = app.platform.graph;
  const samples = graph.find((n) => n.householdId === householdId && n.props.sample === true);
  for (const node of samples) {
    for (const task of graph.neighbors(node.id, { relation: 'about', direction: 'in', type: 'task' })) graph.removeNode(task.id);
    graph.removeNode(node.id);
  }
  return samples.length;
}

export function hasSamples(app: HomeApp, householdId: string): boolean {
  return app.platform.graph.find((n) => n.householdId === householdId && n.props.sample === true).length > 0;
}

/** Anything a person made themselves (not the home, its people or the samples)? */
export function hasRealContent(app: HomeApp, householdId: string): boolean {
  const graph = app.platform.graph;
  return graph
    .find((n) => n.householdId === householdId && n.type !== 'home' && n.type !== 'person' && n.props.sample !== true)
    .some(
      (n) =>
        n.type !== 'task' ||
        !graph.neighbors(n.id, { relation: 'about', direction: 'out' }).every((target) => target.props.sample === true),
    );
}

/** Realistic example items for one shelf (or all of them), marked as samples. Returns how many were added. */
export function seedShelf(app: HomeApp, householdId: string, actorId: string, now: Date, locale = 'en', collection?: ShelfSample['collection']): number {
  const currency = String(app.platform.graph.requireNode(householdId).props.currency ?? 'USD');
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const items = shelfSamples(locale).filter((s) => !collection || s.collection === collection);
  for (const s of items) {
    const attributes: Record<string, unknown> = { collection: s.collection };
    if (s.docType) attributes.docType = s.docType;
    if (s.dateIn !== undefined) attributes.date = iso(s.dateIn);
    if (s.expiresIn !== undefined) attributes.expiresOn = iso(s.expiresIn);
    if (s.amount) attributes.amount = s.amount[currency] ?? s.amount.default;
    app.items.create(actorId, householdId, { kind: 'note', title: s.title, body: s.body, tags: s.tags, attributes, sample: true });
  }
  return items.length;
}
