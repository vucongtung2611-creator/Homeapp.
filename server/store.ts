import { createHomeApp, Platform, type GraphSnapshot, type HomeApp, type Role } from '../src/index.js';
import type { User } from './auth.js';
import type { Database } from './database.js';

export interface HouseholdRow {
  id: string;
  name: string;
  role: Role;
}

/**
 * Loads each household's graph from the database, keeps it in memory, and
 * writes it back after every change. Each household is a separate row and a
 * separate in-memory graph, so homes never share data.
 *
 * Changes to one household are queued (`withLock`) so two requests can't
 * interleave between "change" and "save" and lose an update.
 */
export class HouseholdStore {
  private readonly cache = new Map<string, HomeApp>();
  private readonly loading = new Map<string, Promise<HomeApp | undefined>>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly clock?: () => Date,
  ) {}

  async create(owner: User, input: { name: string; currency: string; kind: 'share_house' | 'family' }): Promise<string> {
    const app = createHomeApp({ clock: this.clock });
    const home = app.platform.createHousehold(input.name, { userId: owner.id, name: owner.name }, { kind: input.kind, currency: input.currency });
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO households (id, name, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        home.id,
        input.name,
        JSON.stringify(app.platform.snapshot()),
        now,
        now,
      );
      await tx.run('INSERT INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, ?, ?)', owner.id, home.id, 'owner', now);
    });
    this.cache.set(home.id, app);
    return home.id;
  }

  async get(householdId: string): Promise<HomeApp | undefined> {
    const cached = this.cache.get(householdId);
    if (cached) return cached;
    let pending = this.loading.get(householdId);
    if (!pending) {
      pending = this.load(householdId).finally(() => this.loading.delete(householdId));
      this.loading.set(householdId, pending);
    }
    return pending;
  }

  private async load(householdId: string): Promise<HomeApp | undefined> {
    const row = await this.db.get<{ graph: string }>('SELECT graph FROM households WHERE id = ?', householdId);
    if (!row) return undefined;
    const app = createHomeApp({ platform: Platform.restore(JSON.parse(row.graph) as GraphSnapshot, this.clock) });
    this.cache.set(householdId, app);
    return app;
  }

  /** Serialise async work per household. */
  async withLock<T>(householdId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(householdId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.catch(() => undefined);
    this.locks.set(householdId, settled);
    try {
      return await run;
    } finally {
      if (this.locks.get(householdId) === settled) this.locks.delete(householdId);
    }
  }

  /** Run a change and persist it. On error the in-memory copy is discarded. */
  mutate<T>(householdId: string, fn: (app: HomeApp) => T): Promise<T> {
    return this.withLock(householdId, async () => {
      const app = await this.get(householdId);
      if (!app) throw new Error('household_not_found');
      try {
        const result = fn(app);
        const home = app.platform.graph.requireNode(householdId);
        await this.db.run(
          'UPDATE households SET graph = ?, name = ?, updated_at = ? WHERE id = ?',
          JSON.stringify(app.platform.snapshot()),
          home.label,
          new Date().toISOString(),
          householdId,
        );
        return result;
      } catch (err) {
        this.cache.delete(householdId);
        throw err;
      }
    });
  }

  async addMember(householdId: string, user: User, role: Role): Promise<void> {
    await this.mutate(householdId, (app) => app.platform.addMember(householdId, user.id, user.name, role));
    await this.db.run(
      'INSERT INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      user.id,
      householdId,
      role,
      new Date().toISOString(),
    );
  }

  async removeMember(householdId: string, userId: string): Promise<void> {
    await this.mutate(householdId, (app) => app.platform.removeMember(householdId, userId));
    await this.db.run('DELETE FROM memberships WHERE user_id = ? AND household_id = ?', userId, householdId);
  }

  householdsOf(userId: string): Promise<HouseholdRow[]> {
    return this.db.all<HouseholdRow>(
      `SELECT h.id, h.name, m.role FROM memberships m JOIN households h ON h.id = m.household_id
       WHERE m.user_id = ? ORDER BY m.joined_at`,
      userId,
    );
  }

  /** The member's role, or undefined when they are not a member (the source of truth is the graph). */
  async roleOf(householdId: string, userId: string): Promise<Role | undefined> {
    return (await this.get(householdId))?.platform.acl.roleOf(userId, householdId);
  }
}
