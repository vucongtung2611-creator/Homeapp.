# Homeapp — AI Household Butler

> *We don't build a smarter home. We build smarter living together.*

A Connected Living Platform: one **Household Graph** that links people, things, money, parcels, recipes and repairs, with **permissions built into the core** and an **AI Butler** that reasons over exactly what the person asking is allowed to see.

> **Light beta:** a phone-first web app with Chat, Library and Bills for a household, in English and Vietnamese (French/German ready for translation) — see [docs/LIGHT.md](docs/LIGHT.md) (Vietnamese) for scope, deployment and the security review. `npm install && npm run build && npm start` → http://localhost:3000

- 📄 [Product vision (VI)](docs/VISION.md)
- 🏗️ [Architecture](docs/ARCHITECTURE.md)
- 🗺️ [Roadmap](docs/ROADMAP.md)

## What works today

| Area | Capabilities |
|---|---|
| **Household Graph** | Typed nodes & relations, traversal for context, de-duplication |
| **Permissions** | 9 roles × 10 data domains, private nodes, explicit sharing, assignment-scoped contractors/cleaners |
| **Capture** | Email → tracking numbers (UPS, USPS, FedEx, DHL, Royal Mail, AusPost), receipts, utility bills; per-integration write scopes |
| **Kitchen** | Inventory with expiry, recipes, *"what can I cook?"* (diet- and expiry-aware), scaled missing ingredients, shared shopping list |
| **Finance** | Bills with exact-to-the-cent splits, payment status, shared expenses, settle-up, monthly reports from what you can see |
| **Delivery** | Parcel hub linked to orders, retailers and recipients |
| **Maintenance** | Issue reports with photos, contractor assignment, status history, repair history per room/asset |
| **Wishlist** | Private wishes, price history, price-drop and target alerts |
| **Wardrobe** | Private garments, wear tracking, unused items, weather/occasion outfits |
| **Butler** | *"Chúng ta có khách tối thứ Bảy"* → menu, missing ingredients, cost, responsibilities, timeline. Understands English and Vietnamese |

## Quick start

```bash
npm install
npm test        # core + server tests
npm run demo    # end-to-end walkthrough
```

```ts
import { createHomeApp } from './src/index.js';

const app = createHomeApp();
const hh = app.platform.createHousehold('12 Elm St', { userId: 'linh', name: 'Linh', diet: ['vegetarian'] }).id;
app.platform.addMember(hh, 'minh', 'Minh', 'property_manager');

app.capture.ingest('linh', hh, {
  source: 'email',
  subject: 'Your electricity bill',
  body: 'Amount due: $312.45. Payment due by 2026-10-20.',
});

app.butler.ask('linh', hh, 'Chúng ta có khách tối thứ Bảy.');
app.maintenance.issues('minh', hh); // the property manager sees maintenance — never bills or wardrobes
```

## Principles

1. **Capture → Understand → Connect → Act.** Information enters once; the system links it and acts.
2. **One graph, many views.** Kitchen, shopping, finance and delivery are views over the same data, not separate apps.
3. **Permission is architecture.** Every read — including the AI's — goes through `AccessControl`.
4. **Share outcomes, not data.** Settle-up tells housemates who owes whom without exposing personal spending.
