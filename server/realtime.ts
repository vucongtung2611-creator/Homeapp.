/**
 * Server-Sent Events hub: one stream per open app tab, grouped by household.
 *
 * Group chat messages are pushed as-is to everyone in the home; private
 * chats (two people, or one person and a character) only to those in them.
 * Other changes are pushed as a bare "changed: <area>" hint — each client then
 * refetches through its own permissions, so nothing private rides along.
 */
export type RealtimeEvent =
  | { type: 'message'; message: unknown }
  | { type: 'message_deleted'; id: string }
  | { type: 'changed'; area: 'library' | 'bills' | 'members' | 'household' | 'requests' | 'inbox' | 'calendar' | 'chores' };

export interface Subscriber {
  userId: string;
  send(event: RealtimeEvent): void;
  close(): void;
}

export class RealtimeHub {
  private readonly rooms = new Map<string, Set<Subscriber>>();

  subscribe(householdId: string, sub: Subscriber): () => void {
    let room = this.rooms.get(householdId);
    if (!room) this.rooms.set(householdId, (room = new Set()));
    room.add(sub);
    return () => {
      room.delete(sub);
      if (room.size === 0) this.rooms.delete(householdId);
    };
  }

  publish(householdId: string, event: RealtimeEvent): void {
    for (const sub of this.rooms.get(householdId) ?? []) {
      try {
        sub.send(event);
      } catch {
        // A broken stream is cleaned up by its own abort handler.
      }
    }
  }

  /** Only to these people (a private chat). */
  publishTo(householdId: string, userIds: string[], event: RealtimeEvent): void {
    for (const sub of this.rooms.get(householdId) ?? []) {
      if (!userIds.includes(sub.userId)) continue;
      try {
        sub.send(event);
      } catch {}
    }
  }

  /** Disconnect a user who was removed from a household. */
  kick(householdId: string, userId: string): void {
    for (const sub of [...(this.rooms.get(householdId) ?? [])]) if (sub.userId === userId) sub.close();
  }

  count(householdId: string): number {
    return this.rooms.get(householdId)?.size ?? 0;
  }
}
