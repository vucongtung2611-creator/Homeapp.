import type { GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export type StorageLocation = 'fridge' | 'freezer' | 'pantry';

export interface InventoryProps extends Record<string, unknown> {
  ingredient: string; // normalised name used for matching
  quantity: number;
  unit: string;
  location: StorageLocation;
  expiresOn?: string; // ISO date
  /** Last known unit price, used for cost estimates. */
  unitPrice?: number;
}

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  /** Estimated price per unit when it has to be bought. */
  unitPrice?: number;
}

export interface RecipeProps extends Record<string, unknown> {
  servings: number;
  ingredients: Ingredient[];
  /** Dietary labels the recipe satisfies, e.g. "vegetarian", "gluten-free". */
  tags: string[];
  minutes?: number;
  source?: 'saved' | 'imported' | 'photo' | 'community';
  rating?: number;
}

export interface ShoppingItemProps extends Record<string, unknown> {
  ingredient: string;
  quantity: number;
  unit: string;
  estimatedCost?: number;
  done: boolean;
}

export interface CookSuggestion {
  recipe: GraphNode<RecipeProps>;
  /** Share of ingredients already at home, 0..1. */
  coverage: number;
  missing: Ingredient[];
  /** Inventory items expiring soon that this recipe would use up. */
  usesExpiring: string[];
  score: number;
}

const DAY = 86_400_000;

export function normaliseIngredient(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (n.endsWith('ies')) return `${n.slice(0, -3)}y`;
  if (n.endsWith('oes')) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss')) return n.slice(0, -1);
  return n;
}

/**
 * Kitchen inventory, recipes and the shopping list. Not a standalone app:
 * recipes link to inventory items, shopping items link back to the recipes
 * that need them, and purchases flow on into finance via receipts.
 */
export class Kitchen {
  constructor(private readonly p: Platform) {}

  addInventory(
    actorId: string,
    householdId: string,
    input: {
      name: string;
      quantity: number;
      unit: string;
      location: StorageLocation;
      expiresOn?: string;
      unitPrice?: number;
    },
  ): GraphNode<InventoryProps> {
    this.p.acl.assertCreate(actorId, householdId, 'kitchen');
    const { name, ...rest } = input;
    const item = this.p.graph.addNode<InventoryProps>({
      type: 'item',
      householdId,
      domain: 'kitchen',
      label: name,
      ownerId: actorId,
      props: { ...rest, ingredient: normaliseIngredient(name) },
    });
    // Connect to any recipe that already uses this ingredient.
    for (const recipe of this.p.graph.findByType<RecipeProps>(householdId, 'recipe')) {
      if (recipe.props.ingredients.some((i) => normaliseIngredient(i.name) === item.props.ingredient)) {
        this.p.graph.link(recipe.id, 'uses_ingredient', item.id);
      }
    }
    return item;
  }

  consume(actorId: string, itemId: string, quantity: number): GraphNode<InventoryProps> | undefined {
    const item = this.p.graph.requireNode<InventoryProps>(itemId);
    this.p.acl.assertWrite(actorId, item);
    const remaining = item.props.quantity - quantity;
    if (remaining <= 0) {
      this.p.graph.removeNode(itemId);
      return undefined;
    }
    return this.p.graph.updateNode<InventoryProps>(itemId, { quantity: remaining });
  }

  inventory(actorId: string, householdId: string): GraphNode<InventoryProps>[] {
    return this.p.acl
      .visible<InventoryProps>(actorId, householdId, 'item')
      .filter((n) => n.domain === 'kitchen');
  }

  expiringSoon(actorId: string, householdId: string, withinDays = 3): GraphNode<InventoryProps>[] {
    const limit = this.p.now().getTime() + withinDays * DAY;
    return this.inventory(actorId, householdId)
      .filter((i) => i.props.expiresOn && Date.parse(i.props.expiresOn) <= limit)
      .sort((a, b) => a.props.expiresOn!.localeCompare(b.props.expiresOn!));
  }

  addRecipe(
    actorId: string,
    householdId: string,
    input: { name: string } & Partial<RecipeProps> & Pick<RecipeProps, 'ingredients' | 'servings'>,
  ): GraphNode<RecipeProps> {
    this.p.acl.assertCreate(actorId, householdId, 'kitchen');
    const { name, ...rest } = input;
    const recipe = this.p.graph.addNode<RecipeProps>({
      type: 'recipe',
      householdId,
      domain: 'kitchen',
      label: name,
      ownerId: actorId,
      props: { tags: [], source: 'saved', ...rest },
    });
    const wanted = new Set(input.ingredients.map((i) => normaliseIngredient(i.name)));
    for (const item of this.p.graph.findByType<InventoryProps>(householdId, 'item')) {
      if (item.domain === 'kitchen' && wanted.has(item.props.ingredient)) {
        this.p.graph.link(recipe.id, 'uses_ingredient', item.id);
      }
    }
    return recipe;
  }

  recipes(actorId: string, householdId: string, diet: string[] = []): GraphNode<RecipeProps>[] {
    const required = diet.map((d) => d.toLowerCase());
    return this.p.acl
      .visible<RecipeProps>(actorId, householdId, 'recipe')
      .filter((r) => required.every((d) => r.props.tags.map((t) => t.toLowerCase()).includes(d)));
  }

  /** Ingredients (scaled to `servings`) not covered by current inventory. */
  missingFor(actorId: string, recipeId: string, servings?: number): Ingredient[] {
    const recipe = this.p.graph.requireNode<RecipeProps>(recipeId);
    this.p.acl.assertRead(actorId, recipe);
    const stock = this.stock(actorId, recipe.householdId);
    const factor = (servings ?? recipe.props.servings) / recipe.props.servings;
    const missing: Ingredient[] = [];
    for (const ing of recipe.props.ingredients) {
      const need = round(ing.quantity * factor);
      // Same unit: compare quantities. Different unit (e.g. "1 bunch" vs "200 g"):
      // without a conversion table, presence counts as enough.
      const have = stock.get(stockKey(ing.name, ing.unit)) ?? (stock.has(stockKey(ing.name, '*')) ? Infinity : 0);
      if (have >= need) continue;
      missing.push({ ...ing, quantity: round(need - have) });
    }
    return missing;
  }

  /** "What can I cook with what I have?" — ranked, expiry-aware, diet-filtered. */
  whatCanICook(
    actorId: string,
    householdId: string,
    options: { diet?: string[]; servings?: number; expiringWithinDays?: number } = {},
  ): CookSuggestion[] {
    const expiring = new Set(
      this.expiringSoon(actorId, householdId, options.expiringWithinDays ?? 3).map((i) => i.props.ingredient),
    );
    return this.recipes(actorId, householdId, options.diet)
      .map((recipe) => {
        const missing = this.missingFor(actorId, recipe.id, options.servings);
        const total = recipe.props.ingredients.length || 1;
        const coverage = (total - missing.length) / total;
        const usesExpiring = recipe.props.ingredients
          .map((i) => normaliseIngredient(i.name))
          .filter((n) => expiring.has(n));
        const score = coverage + 0.25 * usesExpiring.length + 0.05 * (recipe.props.rating ?? 0);
        return { recipe, coverage, missing, usesExpiring, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Adds items to the shared shopping list, merging with existing open entries. */
  addToShoppingList(
    actorId: string,
    householdId: string,
    items: Ingredient[],
    forRecipeId?: string,
  ): GraphNode<ShoppingItemProps>[] {
    this.p.acl.assertCreate(actorId, householdId, 'shopping');
    const open = this.p.graph
      .findByType<ShoppingItemProps>(householdId, 'shopping_item')
      .filter((s) => !s.props.done);
    return items.map((ing) => {
      const ingredient = normaliseIngredient(ing.name);
      const cost = ing.unitPrice !== undefined ? round(ing.unitPrice * ing.quantity) : undefined;
      const existing = open.find((s) => s.props.ingredient === ingredient && s.props.unit === ing.unit);
      const node = existing
        ? this.p.graph.updateNode<ShoppingItemProps>(existing.id, {
            quantity: round(existing.props.quantity + ing.quantity),
            estimatedCost:
              cost !== undefined || existing.props.estimatedCost !== undefined
                ? round((existing.props.estimatedCost ?? 0) + (cost ?? 0))
                : undefined,
          })
        : this.p.graph.addNode<ShoppingItemProps>({
            type: 'shopping_item',
            householdId,
            domain: 'shopping',
            label: ing.name,
            ownerId: actorId,
            props: { ingredient, quantity: ing.quantity, unit: ing.unit, estimatedCost: cost, done: false },
          });
      if (forRecipeId) this.p.graph.link(node.id, 'needed_for', forRecipeId);
      return node;
    });
  }

  shoppingList(actorId: string, householdId: string): GraphNode<ShoppingItemProps>[] {
    return this.p.acl
      .visible<ShoppingItemProps>(actorId, householdId, 'shopping_item')
      .filter((s) => !s.props.done);
  }

  private stock(actorId: string, householdId: string): Map<string, number> {
    const stock = new Map<string, number>();
    for (const item of this.inventory(actorId, householdId)) {
      for (const key of [stockKey(item.props.ingredient, item.props.unit), stockKey(item.props.ingredient, '*')]) {
        stock.set(key, (stock.get(key) ?? 0) + item.props.quantity);
      }
    }
    return stock;
  }
}

const stockKey = (name: string, unit: string) => `${normaliseIngredient(name)}|${unit.toLowerCase()}`;
const round = (n: number) => Math.round(n * 100) / 100;
