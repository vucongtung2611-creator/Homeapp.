# Architecture

This document maps the [product vision](./VISION.md) onto the code in `src/`, and records the design decisions made in the first foundation release.

```
src/
├── graph/            Household Graph — nodes, relations, traversal          (§2)
├── permissions/      Roles, domain policies, AccessControl                  (§8, §11, §13)
├── platform.ts       Shared kernel: one graph + one ACL, households, members
├── integrations/     Capture → Understand → Connect → Act                   (§3, §16)
│   ├── understand.ts     Extractors: tracking numbers, receipts, bills
│   ├── registry.ts       Per-member integration grants and write scopes
│   └── CapturePipeline.ts
├── modules/          Features — all on the same graph                       (§5–§11)
│   ├── kitchen.ts        Inventory, recipes, "what can I cook", shopping list
│   ├── finance.ts        Bills, splitting, shared expenses, settle-up, reports
│   ├── delivery.ts       Parcel hub linked to orders & recipients
│   ├── maintenance.ts    Issues, photos, contractors, repair history
│   ├── wishlist.ts       Private wishes, price history, price-drop alerts
│   ├── wardrobe.ts       Garments, wear tracking, unused items, outfits
│   └── tasks.ts          Shared tasks & household calendar
├── butler/Butler.ts  Context-aware AI layer                                 (§4)
└── index.ts          createHomeApp() wires everything together
```

## 1. The Household Graph

Everything is a `GraphNode` with a `type` (what it is), a `domain` (which part of life it belongs to), an optional `ownerId`, and a `visibility`. Relations are typed edges (`uses_ingredient`, `needed_for`, `purchased_as`, `evidenced_by`, `delivers`, `recipient`, `assigned_to`, …).

The point of the graph is that one real thing is reachable from every module that cares about it. After the Dyson order email is ingested, the graph holds:

```
Parcel ─delivers→ Order ─sold_by→ Retailer(Dyson)
  │                 ├─evidenced_by→ Document(receipt)
  └─recipient→ Linh └─purchased_as→ Transaction ─evidenced_by→ Document(receipt)
```

`HouseholdGraph` is an in-memory store with a deliberately small API (`addNode`, `link`, `neighbors`, `traverse`, `find…`). Modules depend only on that API, so the storage can move to Postgres (nodes/edges tables + JSONB props) or a graph database without touching feature code.

## 2. Permissions are part of the core

Permission is not a feature layered on later — every module call takes an `actorId` and goes through `AccessControl`.

Access is decided in this order:

1. **Owner** of a node can always read and write it.
2. **Private** nodes (`visibility: 'private'`) are readable only by users in `sharedWith`; nobody else, whatever their role.
3. **Household** nodes are governed by the actor's **role policy for the node's domain** (`none` / `read` / `write`).
4. Some roles are **assignment-scoped** in some domains: a contractor sees a maintenance issue only once it is `assigned_to` them; a cleaner sees only the jobs given to them.

Default role policies (`src/permissions/roles.ts`):

| Role | Access |
|---|---|
| owner, family_member | write everywhere |
| child | read kitchen/shopping; write calendar, chat, own wardrobe, maintenance reports |
| tenant | write in everything except `documents` (read) |
| guest | read core + calendar; write communication |
| property_manager | read core; write **maintenance only** |
| cleaner | read core; read maintenance (assigned only) |
| contractor | read core; write maintenance (assigned only) |
| service_provider | read delivery (assigned only) |

Privacy defaults chosen in this release:

- Orders, receipts and purchase transactions captured from a member's inbox are **private** to that member. The *parcel* is household-visible — housemates know something is arriving, not what or how much.
- Personal expenses (one participant) are private; shared expenses are household-visible.
- Wishlists and wardrobes are private.
- Settle-up shares the **outcome** (who pays whom) computed only from shared expenses — no personal transactions are exposed.

The Butler never reads the graph directly: `Butler.context()` uses `AccessControl.traverseAs()`, which neither returns nor expands nodes the asker can't see. **The AI can only know what the person asking is allowed to know.**

## 3. Integration layer: Capture → Understand → Connect → Act

```
Signal (email, bank feed, OCR…) ─▶ Extractor ─▶ Facts ─▶ Connect to graph ─▶ Actions
                                   (understand)  tracking   order/receipt/tx     parcel to watch
                                                 receipt    parcel               bill split + tasks
                                                 bill       bill
```

- `Extractor` is an interface. `RuleBasedExtractor` handles common carriers (UPS, USPS, FedEx, DHL, Royal Mail, Australia Post), receipts and utility bills deterministically, including Vietnamese bill keywords. An LLM-backed extractor can implement the same interface for messy inputs.
- Plain-digit tracking formats (FedEx, DHL) only count when the carrier is named, to avoid treating phone numbers as parcels.
- Connecting de-duplicates: retailers by name, orders by order number, parcels by tracking number — a shipping update for a known parcel doesn't create a second one.
- `IntegrationRegistry` records who connected each integration and which **domains it may write**. A courier integration can create parcels but not bills; facts outside its scope are dropped and reported.

## 4. The Butler (context layer)

`Butler.planGuestDinner()` is the reference implementation of §4's example. For *"Chúng ta có khách tối thứ Bảy"* it:

1. resolves the date (English and Vietnamese weekdays), finds the guest event and other events that day;
2. collects dietary needs of every resident plus the guests — a dish must work for everyone;
3. ranks recipes from what's in the kitchen (coverage + soon-to-expire bonus), scaled to the number of diners;
4. computes missing ingredients, estimated cost (and how many items had no price), budget check;
5. assigns responsibilities round-robin and builds a preparation timeline;
6. with `commit: true`, writes the shopping list and assigned tasks back into the graph.

`Butler.ask()` is a keyword intent router (EN + VI) over the same capabilities. It is intentionally deterministic for now; the seam for an LLM is `Butler.context()`, which returns a permission-filtered, serialisable `ContextSnapshot` that can be handed to a model as grounding.

## Known limitations of this foundation

- Storage is in-memory; there is no persistence or API server yet.
- A person node belongs to the household it was first created in. People who belong to several households (a property manager with many properties) need a separate user/person split.
- Unit conversion is not implemented: if inventory and recipe use different units for the same ingredient, presence is treated as enough.
- Chat / household communication (§11) and community knowledge (§12) are not implemented yet.

See [ROADMAP.md](./ROADMAP.md).
