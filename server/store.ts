import { createHomeApp, Platform, type GraphSnapshot, type HomeApp, type Role } from '../src/index.js';
import type { User } from './auth.js';
import type { Db } from './db.js';

export interface HouseholdRow {
  id: string;
  name: string;
  role: Role;
}

/**
 * Loads each household's graph from SQLite, keeps it in memory, and writes
 * it back after every change. node:sqlite is synchronous, so a `mutate`
 * callback runs start-to-finish without interleaving — no locks needed on a
 * single instance.
 */
export class HouseholdStore {
  private readonly cache = new Map<string, HomeApp>();

  constructor(
    private readonly db: Db,
    private readonly clock?: () => Date,
  ) {}

  create(owner: User, input: { name: string; currency: string; kind: 'share_house' | 'family' }): HomeApp {
    const app = createHomeApp({ clock: this.clock });
    const home = app.platform.createHousehold(input.name, { userId: owner.id, name: owner.name }, {
      kind: input.kind,
      currency: input.currency,
    });
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO households (id, name, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(home.id, input.name, JSON.stringify(app.platform.snapshot()), now, now);
      this.db
        .prepare('INSERT INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run(owner.id, home.id, 'owner', now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.cache.set(home.id, app);
    return app;
  }

  get(householdId: string): HomeApp | undefined {
    const cached = this.cache.get(householdId);
    if (cached) return cached;
    const row = this.db.prepare('SELECT graph FROM households WHERE id = ?').get(householdId) as { graph: string } | undefined;
    if (!row) return undefined;
    const platform = Platform.restore(JSON.parse(row.graph) as GraphSnapshot, this.clock);
    const app = createHomeApp({ platform });
    this.cache.set(householdId, app);
    return app;
  }

  /** Run a change and persist it. On error the in-memory copy is discarded. */
  mutate<T>(householdId: string, fn: (app: HomeApp) => T): T {
    const app = this.get(householdId);
    if (!app) throw new Error('household_not_found');
    try {
      const result = fn(app);
      const home = app.platform.graph.requireNode(householdId);
      this.db
        .prepare('UPDATE households SET graph = ?, name = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(app.platform.snapshot()), home.label, new Date().toISOString(), householdId);
      return result;
    } catch (err) {
      this.cache.delete(householdId);
      throw err;
    }
  }

  addMember(householdId: string, user: User, role: Role): void {
    this.mutate(householdId, (app) => app.platform.addMember(householdId, user.id, user.name, role));
    this.db
      .prepare('INSERT OR IGNORE INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(user.id, householdId, role, new Date().toISOString());
  }

  removeMember(householdId: string, userId: string): void {
    this.mutate(householdId, (app) => app.platform.removeMember(householdId, userId));
    this.db.prepare('DELETE FROM memberships WHERE user_id = ? AND household_id = ?').run(userId, householdId);
  }

  householdsOf(userId: string): HouseholdRow[] {
    return this.db
      .prepare(
        `SELECT h.id, h.name, m.role FROM memberships m JOIN households h ON h.id = m.household_id
         WHERE m.user_id = ? ORDER BY m.joined_at`,
      )
      .all(userId) as unknown as HouseholdRow[];
  }

  /** The member's role, or undefined when they are not a member (the source of truth is the graph). */
  roleOf(householdId: string, userId: string): Role | undefined {
    return this.get(householdId)?.platform.acl.roleOf(userId, householdId);
  }
}
