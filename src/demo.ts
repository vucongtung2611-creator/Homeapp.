/**
 * End-to-end walkthrough: `npm run demo`.
 * Capture → Understand → Connect → Act across one share house.
 */
import { createHomeApp, type DinnerPlan } from './index.js';

const app = createHomeApp({ clock: () => new Date('2026-10-02T09:00:00Z') });
const { platform } = app;

const hh = platform.createHousehold('12 Elm St', { userId: 'linh', name: 'Linh', diet: ['vegetarian'] }, { kind: 'share_house' }).id;
platform.addMember(hh, 'an', 'An', 'tenant');
platform.addMember(hh, 'minh', 'Minh', 'property_manager');
const bathroom = platform.addRoom(hh, 'Bathroom');

const section = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);

section('Capture: two emails arrive');
for (const result of [
  app.capture.ingest('linh', hh, {
    source: 'email',
    from: 'orders@dyson.com.au',
    subject: 'Your Dyson order has shipped',
    body: 'Thank you for shopping with Dyson. Order #DY-88213. Order total: $1,049.00. UPS tracking 1Z999AA10123456784.',
  }),
  app.capture.ingest('linh', hh, {
    source: 'email',
    subject: 'Your electricity bill is ready',
    body: 'Amount due: $312.45. Payment due by 2026-10-20.',
  }),
]) {
  for (const action of result.actions) console.log(`  ✓ ${action}`);
}

section('Kitchen');
app.kitchen.addInventory('linh', hh, { name: 'Eggs', quantity: 6, unit: 'pcs', location: 'fridge', expiresOn: '2026-10-04' });
app.kitchen.addInventory('linh', hh, { name: 'Spinach', quantity: 1, unit: 'bunch', location: 'fridge', expiresOn: '2026-10-03' });
app.kitchen.addInventory('an', hh, { name: 'Rice', quantity: 2000, unit: 'g', location: 'pantry' });
app.kitchen.addRecipe('linh', hh, {
  name: 'Spinach frittata',
  servings: 2,
  minutes: 30,
  tags: ['vegetarian', 'gluten-free'],
  ingredients: [
    { name: 'eggs', quantity: 4, unit: 'pcs', unitPrice: 0.6 },
    { name: 'spinach', quantity: 1, unit: 'bunch', unitPrice: 3 },
    { name: 'feta', quantity: 100, unit: 'g', unitPrice: 0.03 },
  ],
});
console.log(`  Linh asks "what can I cook?" → ${app.butler.ask('linh', hh, 'What can I cook?').text}`);
console.log(`  "Sắp hết hạn?" → ${app.butler.ask('linh', hh, 'Có gì sắp hết hạn không?').text}`);

section('AI Butler: "Chúng ta có khách tối thứ Bảy."');
app.coordination.addEvent('linh', hh, { title: 'Dinner with friends', start: '2026-10-03T18:30', guests: 3, guestDiet: ['gluten-free'] });
const reply = app.butler.ask('linh', hh, 'Chúng ta có khách tối thứ Bảy.');
console.log(`  ${reply.text}`);
const plan = reply.data as DinnerPlan;
for (const step of plan.timeline) console.log(`    ${step.at.padEnd(20)} ${step.step}`);
for (const r of plan.responsibilities) console.log(`    ${r.who.padEnd(6)} ${r.task}`);

section('Maintenance & permissions');
const issue = app.maintenance.reportIssue('an', hh, { title: 'Leaking tap', description: 'Drips all night', roomId: bathroom.id, photos: ['blob://tap.jpg'] });
console.log(`  An reported "${issue.label}".`);
console.log(`  Minh (property manager) sees issues: ${app.maintenance.issues('minh', hh).map((i) => i.label).join(', ')}`);
console.log(`  Minh sees bills: ${app.platform.acl.visible('minh', hh, 'bill').length}, transactions: ${app.platform.acl.visible('minh', hh, 'transaction').length}`);
const parcel = app.delivery.parcels('an', hh)[0]!;
console.log(`  An sees a ${parcel.parcel.props.carrier} parcel for ${parcel.recipient} — order details hidden: ${parcel.order === undefined}`);

section('Finance');
console.log(`  Bills to pay for An: ${app.coordination.tasksFor('an', hh).map((t) => `${t.label} (due ${t.props.dueOn})`).join(', ')}`);
app.finance.recordExpense('linh', hh, { description: 'Groceries', amount: 60, category: 'food', participants: ['linh', 'an'] });
console.log(`  Settle up → ${app.butler.ask('an', hh, 'Ai nợ ai?').text}`);

section('Wishlist');
const wish = app.wishlist.addWish('an', hh, { product: 'Dyson Hot+Cool', price: 899 });
for (const alert of app.wishlist.recordPrice(app.wishlist.productOf(wish.id)!.id, 799)) console.log(`  🔔 ${alert.message}`);

console.log(`\nGraph: ${platform.graph.size.nodes} nodes, ${platform.graph.size.edges} edges`);
