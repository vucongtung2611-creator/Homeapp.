# Roadmap

## Phase 0 — Foundation ✅ (this release)

- Household Graph with typed nodes, relations and permission-aware traversal
- Role/domain permission model with private nodes, explicit sharing and assignment-scoped roles
- Capture pipeline: tracking numbers, receipts and bills from email-like signals; integration scopes
- Modules: Kitchen, Finance, Delivery, Maintenance, Wishlist, Wardrobe, Tasks & Calendar
- Butler: guest-dinner planning, "what can I cook", parcels, settle-up, repairs, tasks (EN + VI)

## Phase 1 — Make it real

- Persistence: Postgres (`nodes`, `edges`, JSONB props; row-level security mirroring `AccessControl`)
- HTTP/GraphQL API with authentication; actor comes from the session, never the request body
- Mobile-first client (React Native / Expo): kitchen inventory, shopping list, parcels, bills, issue reporting with camera
- First real integrations: Gmail/Outlook (read-only, receipts & tracking), Google/Apple Calendar, one courier tracking API
- Audit log of every cross-domain read (who/what saw which node, including the Butler)

## Phase 2 — AI Butler

- LLM-backed `Extractor` for receipts, photographed recipes and messy emails (structured output, human-confirm step)
- LLM reasoner over `Butler.context()` snapshots with tool calls into the modules — reads always via the asker's ACL
- Proactive reminders: expiring food, bills due, parcels arriving, warranty expiry
- Meal planning across the week with budget targets

## Phase 3 — Household life

- Household chat with per-space membership (parents / children / residents / landlord)
- Open banking feed for household expenses; budgets and saving goals
- Warranties and assets: purchase → receipt → warranty → maintenance history
- Smart-home device status into maintenance

## Phase 4 — Community knowledge

- Opt-in sharing of recipes, tips and product experiences
- Anonymised, aggregated household benchmarks (k-anonymity / differential privacy)
- Fashion intelligence from voluntarily shared wardrobe data
- Retailer and affiliate integrations for price tracking and purchasing
