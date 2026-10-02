import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HouseholdGraph } from '../src/graph/HouseholdGraph.js';

test('one real-world thing connects across modules', () => {
  const g = new HouseholdGraph();
  const hh = 'h1';
  const milk = g.addNode({ type: 'item', householdId: hh, domain: 'kitchen', label: 'Milk' });
  const recipe = g.addNode({ type: 'recipe', householdId: hh, domain: 'kitchen', label: 'Pancakes' });
  const list = g.addNode({ type: 'shopping_item', householdId: hh, domain: 'shopping', label: 'Milk' });
  const receipt = g.addNode({ type: 'document', householdId: hh, domain: 'documents', label: 'Receipt' });
  const tx = g.addNode({ type: 'transaction', householdId: hh, domain: 'finance', label: 'Groceries' });
  g.link(recipe.id, 'uses_ingredient', milk.id);
  g.link(list.id, 'needed_for', recipe.id);
  g.link(milk.id, 'evidenced_by', receipt.id);
  g.link(tx.id, 'evidenced_by', receipt.id);

  const ctx = g.traverse(milk.id, 2);
  assert.deepEqual(new Set(ctx.nodes.map((n) => n.label)), new Set(['Milk', 'Pancakes', 'Receipt', 'Groceries']));
  assert.equal(g.traverse(milk.id, 1).nodes.length, 3);
});

test('link is idempotent and removeNode cleans edges', () => {
  const g = new HouseholdGraph();
  const a = g.addNode({ type: 'item', householdId: 'h', domain: 'core', label: 'A' });
  const b = g.addNode({ type: 'item', householdId: 'h', domain: 'core', label: 'B' });
  const e1 = g.link(a.id, 'linked_to', b.id);
  const e2 = g.link(a.id, 'linked_to', b.id);
  assert.equal(e1.id, e2.id);
  assert.equal(g.size.edges, 1);
  g.removeNode(b.id);
  assert.equal(g.size.edges, 0);
  assert.deepEqual(g.neighbors(a.id), []);
});

test('traverse does not expand through filtered nodes', () => {
  const g = new HouseholdGraph();
  const a = g.addNode({ type: 'item', householdId: 'h', domain: 'core', label: 'A' });
  const secret = g.addNode({ type: 'item', householdId: 'h', domain: 'core', label: 'Secret' });
  const c = g.addNode({ type: 'item', householdId: 'h', domain: 'core', label: 'C' });
  g.link(a.id, 'linked_to', secret.id);
  g.link(secret.id, 'linked_to', c.id);
  const sub = g.traverse(a.id, 3, (n) => n.label !== 'Secret');
  assert.deepEqual(sub.nodes.map((n) => n.label), ['A']);
  assert.equal(sub.edges.length, 0);
});
