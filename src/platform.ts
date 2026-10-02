import { randomUUID } from 'node:crypto';
import { HouseholdGraph } from './graph/HouseholdGraph.js';
import type { GraphNode } from './graph/types.js';
import { AccessControl } from './permissions/AccessControl.js';
import type { Role } from './permissions/roles.js';

export interface PersonProps extends Record<string, unknown> {
  role: Role;
  /** Dietary preferences/restrictions, e.g. ["vegetarian", "nut-free"]. */
  diet?: string[];
  email?: string;
}

export interface HomeProps extends Record<string, unknown> {
  kind: 'family' | 'share_house' | 'single';
  currency: string;
  address?: string;
}

/** Shared kernel handed to every module: one graph, one permission system. */
export class Platform {
  readonly graph: HouseholdGraph;
  readonly acl: AccessControl;

  constructor(clock?: () => Date) {
    this.graph = new HouseholdGraph(clock);
    this.acl = new AccessControl(this.graph);
  }

  now(): Date {
    return this.graph.now();
  }

  createHousehold(
    name: string,
    owner: { userId: string; name: string; diet?: string[]; email?: string },
    props: Partial<HomeProps> = {},
  ): GraphNode<HomeProps> {
    // A home is the root of its household: its id is the household id.
    const id = randomUUID();
    const home = this.graph.addNode<HomeProps>({
      id,
      type: 'home',
      householdId: id,
      domain: 'core',
      label: name,
      props: { kind: 'family', currency: 'AUD', ...props },
    });
    this.addMember(home.id, owner.userId, owner.name, 'owner', { diet: owner.diet, email: owner.email });
    return home;
  }

  /**
   * Adds a person to a household. Person nodes use the user id as node id so
   * assignments (`issue -[assigned_to]-> userId`) resolve directly.
   */
  addMember(
    householdId: string,
    userId: string,
    name: string,
    role: Role,
    extra: Omit<PersonProps, 'role'> = {},
  ): GraphNode<PersonProps> {
    const home = this.graph.requireNode(householdId);
    const person =
      this.graph.getNode<PersonProps>(userId) ??
      this.graph.addNode<PersonProps>({
        id: userId,
        type: 'person',
        householdId,
        domain: 'core',
        label: name,
        ownerId: userId,
        props: { role, ...stripUndefined(extra) },
      });
    this.graph.link(person.id, 'member_of', home.id, { role });
    this.acl.grant(userId, householdId, role);
    return person;
  }

  addRoom(householdId: string, name: string): GraphNode {
    const room = this.graph.addNode({ type: 'room', householdId, domain: 'core', label: name });
    this.graph.link(householdId, 'contains', room.id);
    return room;
  }

  /** Members holding resident roles (people who actually live in the home). */
  residents(householdId: string): GraphNode<PersonProps>[] {
    const residentRoles: Role[] = ['owner', 'family_member', 'child', 'tenant'];
    return this.acl
      .members(householdId)
      .filter((m) => residentRoles.includes(m.role))
      .map((m) => this.graph.requireNode<PersonProps>(m.userId));
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
