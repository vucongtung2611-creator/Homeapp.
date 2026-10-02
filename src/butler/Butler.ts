import type { GraphEdge, GraphNode, NodeType, Props } from '../graph/types.js';
import type { Delivery } from '../modules/delivery.js';
import type { Finance } from '../modules/finance.js';
import type { Ingredient, Kitchen } from '../modules/kitchen.js';
import { normaliseIngredient } from '../modules/kitchen.js';
import type { Maintenance } from '../modules/maintenance.js';
import type { Coordination } from '../modules/tasks.js';
import type { PersonProps, Platform } from '../platform.js';

export interface DinnerPlan {
  date: string;
  serveAt: string;
  guests: number;
  diners: number;
  dietaryNeeds: string[];
  /** Other things already on the calendar that day. */
  clashes: string[];
  menu: { recipeId: string; name: string; servings: number; minutes?: number }[];
  missingIngredients: Ingredient[];
  estimatedCost: number;
  /** Missing ingredients we had no price for (cost is a lower bound if > 0). */
  unpricedItems: number;
  currency: string;
  withinBudget?: boolean;
  responsibilities: { who: string; task: string }[];
  timeline: { at: string; step: string }[];
}

export interface ButlerReply {
  intent: string;
  text: string;
  data?: unknown;
}

/** Permission-filtered, serialisable slice of the graph — what an LLM would be given. */
export interface ContextSnapshot {
  focus: string;
  nodes: { id: string; type: NodeType; label: string; props: Props }[];
  edges: Pick<GraphEdge, 'from' | 'relation' | 'to'>[];
}

const WEEKDAYS: [RegExp, number][] = [
  [/sunday|chủ nhật|chu nhat/i, 0],
  [/monday|thứ hai|thu hai|thứ 2/i, 1],
  [/tuesday|thứ ba|thu ba\b|thứ 3/i, 2],
  [/wednesday|thứ tư|thu tu|thứ 4/i, 3],
  [/thursday|thứ năm|thu nam|thứ 5/i, 4],
  [/friday|thứ sáu|thu sau|thứ 6/i, 5],
  [/saturday|thứ bảy|thứ bẩy|thu bay|thứ 7/i, 6],
];

/**
 * The AI Household Butler: a context layer over the whole graph.
 *
 * It never reads the graph directly — every lookup goes through the modules
 * and the AccessControl of the person asking, so the butler can only reason
 * over what that person is allowed to see. The planning here is deterministic;
 * `context()` produces the same permission-filtered slice for an LLM-backed
 * reasoner to use.
 */
export class Butler {
  constructor(
    private readonly p: Platform,
    private readonly kitchen: Kitchen,
    private readonly finance: Finance,
    private readonly coordination: Coordination,
    private readonly delivery: Delivery,
    private readonly maintenance: Maintenance,
  ) {}

  /** "We have guests on Saturday night." */
  planGuestDinner(
    actorId: string,
    householdId: string,
    input: { date: string; guests?: number; guestDiet?: string[]; budget?: number; serveAt?: string; commit?: boolean },
  ): DinnerPlan {
    const events = this.coordination.eventsOn(actorId, householdId, input.date);
    const guestEvent = events.find((e) => (e.props.guests ?? 0) > 0);
    const guests = input.guests ?? guestEvent?.props.guests ?? 0;
    const residents = this.p.residents(householdId);
    const diners = residents.length + guests;
    const dietaryNeeds = unique([
      ...residents.flatMap((r) => r.props.diet ?? []),
      ...(input.guestDiet ?? guestEvent?.props.guestDiet ?? []),
    ]);
    const serveAt = input.serveAt ?? guestEvent?.props.start.slice(11, 16) ?? '19:00';

    const suggestions = this.kitchen.whatCanICook(actorId, householdId, { diet: dietaryNeeds, servings: diners });
    const chosen = suggestions.slice(0, 2);
    const menu = chosen.map((s) => ({
      recipeId: s.recipe.id,
      name: s.recipe.label,
      servings: diners,
      minutes: s.recipe.props.minutes,
    }));

    const missingIngredients = mergeIngredients(chosen.flatMap((s) => s.missing));
    let estimatedCost = 0;
    let unpricedItems = 0;
    for (const ing of missingIngredients) {
      if (ing.unitPrice === undefined) unpricedItems++;
      else estimatedCost += ing.unitPrice * ing.quantity;
    }
    estimatedCost = Math.round(estimatedCost * 100) / 100;

    const names = residents.map((r) => r.label);
    const roles = ['Shopping', 'Cooking', 'Table & drinks', 'Clean-up'];
    const responsibilities = names.length
      ? roles.map((task, i) => ({ who: names[i % names.length]!, task }))
      : [];

    const longest = Math.max(30, ...menu.map((m) => m.minutes ?? 45));
    const timeline = [
      ...(missingIngredients.length ? [{ at: `${previousDay(input.date)} evening`, step: 'Buy or order missing ingredients' }] : []),
      { at: `${input.date} ${shiftTime(serveAt, -(longest + 60))}`, step: 'Prep: wash, chop, set the table' },
      { at: `${input.date} ${shiftTime(serveAt, -longest)}`, step: `Start cooking ${menu.map((m) => m.name).join(' + ') || 'dinner'}` },
      { at: `${input.date} ${serveAt}`, step: 'Serve' },
    ];

    const plan: DinnerPlan = {
      date: input.date,
      serveAt,
      guests,
      diners,
      dietaryNeeds,
      clashes: events.filter((e) => e !== guestEvent).map((e) => `${e.props.start.slice(11, 16)} ${e.label}`),
      menu,
      missingIngredients,
      estimatedCost,
      unpricedItems,
      currency: (this.p.graph.getNode(householdId)?.props.currency as string | undefined) ?? 'AUD',
      withinBudget: input.budget === undefined ? undefined : estimatedCost <= input.budget,
      responsibilities,
      timeline,
    };

    if (input.commit) this.commitDinnerPlan(actorId, householdId, plan, residents);
    return plan;
  }

  /** Turn a plan into shared state: shopping list entries and assigned tasks. */
  commitDinnerPlan(
    actorId: string,
    householdId: string,
    plan: DinnerPlan,
    residents: GraphNode<PersonProps>[] = this.p.residents(householdId),
  ): void {
    if (plan.missingIngredients.length) {
      this.kitchen.addToShoppingList(actorId, householdId, plan.missingIngredients, plan.menu[0]?.recipeId);
    }
    const byName = new Map(residents.map((r) => [r.label, r.id]));
    for (const r of plan.responsibilities) {
      const userId = byName.get(r.who);
      this.coordination.createTask(actorId, householdId, {
        title: `${r.task} for dinner on ${plan.date}`,
        domain: 'calendar',
        dueOn: plan.date,
        assignees: userId ? [userId] : [],
      });
    }
  }

  /** Natural-language entry point (English and Vietnamese keywords). */
  ask(actorId: string, householdId: string, text: string): ButlerReply {
    const t = text.normalize('NFC').toLowerCase();

    if (/guest|visitor|dinner party|khách/.test(t)) {
      const date = this.resolveDate(t);
      const count = /(\d+)\s*(?:guests?|people|visitors?|khách|người)/.exec(t)?.[1];
      const plan = this.planGuestDinner(actorId, householdId, { date, guests: count ? Number(count) : undefined });
      const menu = plan.menu.map((m) => m.name).join(', ') || 'no recipe fits everyone yet';
      const text =
        `Dinner for ${plan.diners} on ${plan.date} at ${plan.serveAt}. Menu: ${menu}. ` +
        (plan.missingIngredients.length
          ? `Need to buy ${plan.missingIngredients.map((i) => i.name).join(', ')} (~${plan.currency} ${plan.estimatedCost.toFixed(2)}).`
          : 'Everything is already in the kitchen.') +
        (plan.dietaryNeeds.length ? ` Dietary needs covered: ${plan.dietaryNeeds.join(', ')}.` : '') +
        (plan.clashes.length ? ` Note: also on that day — ${plan.clashes.join('; ')}.` : '');
      return { intent: 'plan_guest_dinner', text, data: plan };
    }

    if (/expir|hết hạn|sắp hỏng|use up/.test(t)) {
      const items = this.kitchen.expiringSoon(actorId, householdId, 3);
      return {
        intent: 'expiring',
        text: items.length
          ? `Use soon: ${items.map((i) => `${i.label} (${i.props.expiresOn})`).join(', ')}.`
          : 'Nothing is about to expire.',
        data: items,
      };
    }

    if (/cook|recipe|nấu|món/.test(t)) {
      const ideas = this.kitchen.whatCanICook(actorId, householdId).slice(0, 3);
      return {
        intent: 'what_can_i_cook',
        text: ideas.length
          ? ideas
              .map((s) =>
                `${s.recipe.label} (${Math.round(s.coverage * 100)}% in stock` +
                (s.usesExpiring.length ? `, uses up ${s.usesExpiring.join(', ')}` : '') +
                ')',
              )
              .join('; ')
          : 'No saved recipes yet.',
        data: ideas,
      };
    }

    if (/parcel|package|deliver|bưu kiện|giao hàng|đơn hàng/.test(t)) {
      const parcels = this.delivery.summaries(actorId, householdId);
      return {
        intent: 'parcels',
        text: parcels.length
          ? parcels
              .map(
                (v) =>
                  `${v.label}${v.trackingNumber ? ` (${v.carrier} ${v.trackingNumber})` : ''} for ${v.recipientName ?? 'household'}: ${v.status}`,
              )
              .join('; ')
          : 'No parcels on the way.',
        data: parcels,
      };
    }

    if (/bill|owe|settle|hóa đơn|hoá đơn|nợ|chia tiền/.test(t)) {
      const transfers = this.finance.settleUp(actorId, householdId);
      const label = (id: string) => this.p.graph.getNode(id)?.label ?? id;
      return {
        intent: 'settle_up',
        text: transfers.length
          ? transfers.map((tr) => `${label(tr.from)} → ${label(tr.to)}: ${tr.amount.toFixed(2)}`).join('; ')
          : 'Everyone is square.',
        data: transfers,
      };
    }

    if (/broken|leak|repair|maintenance|sửa|hỏng|rò/.test(t)) {
      const issues = this.maintenance.issues(actorId, householdId, { open: true });
      return {
        intent: 'maintenance',
        text: issues.length ? issues.map((i) => `${i.label}: ${i.props.status}`).join('; ') : 'No open maintenance issues.',
        data: issues,
      };
    }

    if (/task|todo|to-do|việc/.test(t)) {
      const tasks = this.coordination.tasksFor(actorId, householdId);
      return {
        intent: 'my_tasks',
        text: tasks.length ? tasks.map((x) => `${x.label}${x.props.dueOn ? ` (due ${x.props.dueOn})` : ''}`).join('; ') : 'Nothing on your list.',
        data: tasks,
      };
    }

    return {
      intent: 'unknown',
      text: 'I can plan meals for guests, suggest what to cook, track parcels, split bills, and follow up on repairs and tasks.',
    };
  }

  /** Permission-filtered neighbourhood of a node, ready to hand to a language model. */
  context(actorId: string, nodeId: string, depth = 2): ContextSnapshot {
    const sub = this.p.acl.traverseAs(actorId, nodeId, depth);
    return {
      focus: nodeId,
      nodes: sub.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, props: n.props })),
      edges: sub.edges.map((e) => ({ from: e.from, relation: e.relation, to: e.to })),
    };
  }

  private resolveDate(text: string): string {
    const today = this.p.now();
    if (/tomorrow|ngày mai/.test(text)) return isoDate(addDays(today, 1));
    if (/today|tonight|hôm nay|tối nay/.test(text)) return isoDate(today);
    const explicit = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
    if (explicit) return explicit;
    const weekday = WEEKDAYS.find(([re]) => re.test(text))?.[1];
    if (weekday !== undefined) return isoDate(addDays(today, (weekday - today.getUTCDay() + 7) % 7));
    return isoDate(today);
  }
}

function mergeIngredients(items: Ingredient[]): Ingredient[] {
  const merged = new Map<string, Ingredient>();
  for (const ing of items) {
    const key = `${normaliseIngredient(ing.name)}|${ing.unit}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, quantity: Math.round((prev.quantity + ing.quantity) * 100) / 100 } : { ...ing });
  }
  return [...merged.values()];
}

const unique = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const previousDay = (date: string) => isoDate(addDays(new Date(`${date}T00:00:00Z`), -1));

function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h ?? 0) * 60 + (m ?? 0) + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
