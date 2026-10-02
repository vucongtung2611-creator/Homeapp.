import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHomeApp } from '../src/index.js';
import { NOW, shareHouse } from './fixtures.js';

test('wishlist alerts when the price drops below the saved price or target', () => {
  const { app, hh } = shareHouse();
  const wish = app.wishlist.addWish('linh', hh, { product: 'Dyson Hot+Cool', price: 899, targetPrice: 700 });
  const product = app.wishlist.productOf(wish.id)!;

  assert.deepEqual(app.wishlist.recordPrice(product.id, 950), []);
  const [drop] = app.wishlist.recordPrice(product.id, 849);
  assert.equal(drop!.reason, 'below_saved_price');
  assert.equal(drop!.ownerId, 'linh');
  const [target] = app.wishlist.recordPrice(product.id, 699);
  assert.equal(target!.reason, 'reached_target');
  assert.equal(app.wishlist.lowestPrice(product.id), 699);

  // Wishes are private.
  assert.deepEqual(app.wishlist.wishes('an', hh), []);
  assert.equal(app.wishlist.wishes('linh', hh).length, 1);
});

test('wardrobe tracks wear, finds unused clothes and suggests weather-aware outfits', () => {
  let now = NOW;
  const app = createHomeApp({ clock: () => now });
  const hh = app.platform.createHousehold('Flat', { userId: 'mai', name: 'Mai' }).id;
  app.platform.addMember(hh, 'son', 'Son', 'family_member');
  const tee = app.wardrobe.addGarment('mai', hh, { name: 'White tee', category: 'top', colour: 'white', warmth: 1 });
  const knit = app.wardrobe.addGarment('mai', hh, { name: 'Wool jumper', category: 'top', colour: 'grey', warmth: 3 });
  const jeans = app.wardrobe.addGarment('mai', hh, { name: 'Jeans', category: 'bottom', colour: 'blue' });
  const coat = app.wardrobe.addGarment('mai', hh, { name: 'Trench', category: 'outerwear', colour: 'beige', warmth: 3 });
  const sneakers = app.wardrobe.addGarment('mai', hh, { name: 'Sneakers', category: 'shoes', colour: 'white' });

  app.wardrobe.wear('mai', [tee.id, jeans.id, sneakers.id]);
  assert.ok(app.platform.graph.edgeBetween(jeans.id, 'worn_with', tee.id) || app.platform.graph.edgeBetween(tee.id, 'worn_with', jeans.id));

  const cold = app.wardrobe.suggestOutfit('mai', hh, { temperatureC: 8 })!;
  assert.deepEqual(cold.pieces.map((p) => p.label), ['Wool jumper', 'Jeans', 'Sneakers', 'Trench']);
  const hot = app.wardrobe.suggestOutfit('mai', hh, { temperatureC: 30 })!;
  assert.deepEqual(hot.pieces.map((p) => p.label), ['White tee', 'Jeans', 'Sneakers']);

  now = new Date('2027-06-01T00:00:00Z');
  assert.deepEqual(app.wardrobe.unused('mai', hh, 180).map((g) => g.label).sort(), ['Jeans', 'Sneakers', 'Trench', 'White tee', 'Wool jumper']);
  app.wardrobe.wear('mai', [knit.id, coat.id]);
  assert.deepEqual(app.wardrobe.unused('mai', hh, 180).map((g) => g.label).sort(), ['Jeans', 'Sneakers', 'White tee']);

  // Family members don't see each other's wardrobes.
  assert.deepEqual(app.wardrobe.garments('son', hh), []);
});
