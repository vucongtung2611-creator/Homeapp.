import { createHomeApp } from '../src/index.js';

/** Friday 2 October 2026, 09:00 UTC. */
export const NOW = new Date('2026-10-02T09:00:00Z');

/**
 * A share house: Linh (owner) and An (tenant) live there, Minh is the
 * property manager, Bao is a contractor, Chi is a guest.
 */
export function shareHouse() {
  const app = createHomeApp({ clock: () => NOW });
  const { platform } = app;
  const home = platform.createHousehold('12 Elm St', { userId: 'linh', name: 'Linh', diet: ['vegetarian'] }, { kind: 'share_house' });
  const hh = home.id;
  platform.addMember(hh, 'an', 'An', 'tenant');
  platform.addMember(hh, 'minh', 'Minh', 'property_manager');
  platform.addMember(hh, 'bao', 'Bao', 'contractor');
  platform.addMember(hh, 'chi', 'Chi', 'guest');
  const kitchenRoom = platform.addRoom(hh, 'Kitchen');
  const bathroom = platform.addRoom(hh, 'Bathroom');
  return { app, hh, kitchenRoom, bathroom };
}

/** Share house with a stocked fridge and three saved recipes. */
export function stockedKitchen() {
  const ctx = shareHouse();
  const { app, hh } = ctx;
  app.kitchen.addInventory('linh', hh, { name: 'Eggs', quantity: 6, unit: 'pcs', location: 'fridge', expiresOn: '2026-10-04' });
  app.kitchen.addInventory('linh', hh, { name: 'Spinach', quantity: 1, unit: 'bunch', location: 'fridge', expiresOn: '2026-10-03' });
  app.kitchen.addInventory('an', hh, { name: 'Rice', quantity: 2000, unit: 'g', location: 'pantry' });
  app.kitchen.addInventory('an', hh, { name: 'Tomatoes', quantity: 3, unit: 'pcs', location: 'fridge', expiresOn: '2026-10-20' });
  const frittata = app.kitchen.addRecipe('linh', hh, {
    name: 'Spinach frittata',
    servings: 2,
    minutes: 30,
    tags: ['vegetarian', 'gluten-free'],
    ingredients: [
      { name: 'eggs', quantity: 4, unit: 'pcs' },
      { name: 'spinach', quantity: 1, unit: 'bunch' },
      { name: 'feta', quantity: 100, unit: 'g', unitPrice: 0.03 },
    ],
  });
  const friedRice = app.kitchen.addRecipe('an', hh, {
    name: 'Tomato egg fried rice',
    servings: 4,
    minutes: 25,
    tags: ['vegetarian'],
    ingredients: [
      { name: 'rice', quantity: 400, unit: 'g' },
      { name: 'egg', quantity: 4, unit: 'pcs' },
      { name: 'tomato', quantity: 2, unit: 'pcs' },
    ],
  });
  const chicken = app.kitchen.addRecipe('an', hh, {
    name: 'Chicken curry',
    servings: 4,
    tags: [],
    ingredients: [
      { name: 'chicken thigh', quantity: 800, unit: 'g', unitPrice: 0.015 },
      { name: 'rice', quantity: 400, unit: 'g' },
    ],
  });
  return { ...ctx, frittata, friedRice, chicken };
}
