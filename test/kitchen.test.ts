import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stockedKitchen } from './fixtures.js';

test('recipes link to the inventory items they use', () => {
  const { app, frittata } = stockedKitchen();
  const uses = app.platform.graph.neighbors(frittata.id, { relation: 'uses_ingredient' }).map((n) => n.label);
  assert.deepEqual(uses.sort(), ['Eggs', 'Spinach']);
});

test('what can I cook: ranked by stock and expiry, filtered by diet', () => {
  const { app, hh } = stockedKitchen();
  const ideas = app.kitchen.whatCanICook('linh', hh, { diet: ['vegetarian'] });
  // Chicken curry is excluded by diet; fried rice is fully in stock and uses the eggs.
  assert.deepEqual(ideas.map((i) => i.recipe.label), ['Tomato egg fried rice', 'Spinach frittata']);
  assert.equal(ideas[0]!.coverage, 1);
  assert.deepEqual(ideas[1]!.missing.map((m) => m.name), ['feta']);
  assert.deepEqual(ideas[1]!.usesExpiring.sort(), ['egg', 'spinach']);
});

test('missing ingredients scale with servings and merge into the shopping list', () => {
  const { app, hh, friedRice } = stockedKitchen();
  const missing = app.kitchen.missingFor('linh', friedRice.id, 8);
  assert.deepEqual(missing, [
    { name: 'egg', quantity: 2, unit: 'pcs' },
    { name: 'tomato', quantity: 1, unit: 'pcs' },
  ]);
  app.kitchen.addToShoppingList('linh', hh, missing, friedRice.id);
  app.kitchen.addToShoppingList('an', hh, [{ name: 'Eggs', quantity: 6, unit: 'pcs' }]);
  const list = app.kitchen.shoppingList('an', hh);
  assert.deepEqual(list.map((s) => [s.label, s.props.quantity]), [['egg', 8], ['tomato', 1]]);
});

test('expiring soon and consumption', () => {
  const { app, hh } = stockedKitchen();
  assert.deepEqual(app.kitchen.expiringSoon('an', hh, 3).map((i) => i.label), ['Spinach', 'Eggs']);
  const spinach = app.kitchen.expiringSoon('an', hh, 1)[0]!;
  assert.equal(app.kitchen.consume('an', spinach.id, 1), undefined);
  assert.deepEqual(app.kitchen.expiringSoon('an', hh, 3).map((i) => i.label), ['Eggs']);
});
