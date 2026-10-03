import type { HomeApp } from '../src/index.js';
import { samplesFor } from './samples.js';

/** Sample content so a brand-new home isn't empty. Everything is marked `sample` and can be cleared in one tap. */
export function seedSamples(app: HomeApp, householdId: string, ownerId: string, now: Date, locale = 'en'): void {
  const content = samplesFor(locale);
  const currency = String(app.platform.graph.requireNode(householdId).props.currency ?? 'USD');
  const wholeUnits = ['VND', 'JPY', 'KRW'].includes(currency);
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  for (const note of content.notes) {
    app.items.create(ownerId, householdId, { kind: 'note', ...note, sample: true });
  }
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
