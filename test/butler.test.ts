import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DinnerPlan } from '../src/index.js';
import { stockedKitchen } from './fixtures.js';

test('"Chúng ta có khách tối thứ Bảy" pulls calendar, diets, inventory and cost together', () => {
  const { app, hh } = stockedKitchen();
  app.coordination.addEvent('linh', hh, {
    title: 'Dinner with friends',
    start: '2026-10-03T18:30',
    guests: 3,
    guestDiet: ['gluten-free'],
  });
  app.coordination.addEvent('an', hh, { title: 'Football', start: '2026-10-03T09:00' });

  const reply = app.butler.ask('linh', hh, 'Chúng ta có khách tối thứ Bảy.');
  assert.equal(reply.intent, 'plan_guest_dinner');
  const plan = reply.data as DinnerPlan;
  assert.equal(plan.date, '2026-10-03');
  assert.equal(plan.serveAt, '18:30');
  assert.equal(plan.diners, 5);
  assert.deepEqual(plan.dietaryNeeds, ['vegetarian', 'gluten-free']);
  // Only the frittata is both vegetarian and gluten-free.
  assert.deepEqual(plan.menu.map((m) => m.name), ['Spinach frittata']);
  assert.deepEqual(
    plan.missingIngredients.map((i) => [i.name, i.quantity]),
    [['eggs', 4], ['spinach', 1.5], ['feta', 250]],
  );
  assert.equal(plan.estimatedCost, 7.5);
  assert.equal(plan.unpricedItems, 2);
  assert.deepEqual(plan.clashes, ['09:00 Football']);
  assert.deepEqual(plan.timeline.map((s) => s.at), ['2026-10-02 evening', '2026-10-03 17:00', '2026-10-03 18:00', '2026-10-03 18:30']);
  assert.deepEqual(plan.responsibilities.map((r) => r.who), ['Linh', 'An', 'Linh', 'An']);
});

test('committing a plan creates shopping items and assigned tasks', () => {
  const { app, hh } = stockedKitchen();
  app.butler.planGuestDinner('linh', hh, { date: '2026-10-03', guests: 2, budget: 50, commit: true });
  assert.ok(app.kitchen.shoppingList('an', hh).length > 0);
  assert.deepEqual(
    app.coordination.tasksFor('an', hh).map((t) => t.label),
    ['Cooking for dinner on 2026-10-03', 'Clean-up for dinner on 2026-10-03'],
  );
});

test('the butler only reasons over what the asker may see', () => {
  const { app, hh } = stockedKitchen();
  assert.equal(app.butler.ask('chi', hh, 'What can I cook?').text, 'No saved recipes yet.');
  assert.match(app.butler.ask('linh', hh, 'what can I cook tonight?').text, /fried rice/);
});

test('intent routing covers parcels, bills and repairs', () => {
  const { app, hh, bathroom } = stockedKitchen();
  app.capture.ingest('an', hh, { source: 'email', body: 'Your UPS parcel 1Z999AA10123456784 has shipped' });
  app.finance.recordExpense('linh', hh, { description: 'Groceries', amount: 40, category: 'food', shared: true });
  app.maintenance.reportIssue('an', hh, { title: 'Leaking tap', description: '', roomId: bathroom.id });

  // Linh sees An's parcel exists, but not its tracking number.
  assert.equal(app.butler.ask('linh', hh, 'Bưu kiện của mình đâu rồi?').text, 'UPS parcel for An: expected');
  assert.match(app.butler.ask('an', hh, 'any parcels?').text, /UPS 1Z999AA10123456784/);
  assert.equal(app.butler.ask('an', hh, 'Who owes what?').text, 'An → Linh: 20.00');
  assert.equal(app.butler.ask('minh', hh, 'anything broken?').text, 'Leaking tap: reported');
  assert.equal(app.butler.ask('linh', hh, 'hello').intent, 'unknown');
});
