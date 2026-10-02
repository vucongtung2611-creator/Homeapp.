import type { HouseholdGraph, Subgraph } from '../graph/HouseholdGraph.js';
import type { Domain, GraphNode, NodeType, Props } from '../graph/types.js';
import { DEFAULT_POLICIES, satisfies, type Access, type Role, type RolePolicy } from './roles.js';

export interface Membership {
  userId: string;
  householdId: string;
  role: Role;
}

export class PermissionDeniedError extends Error {
  constructor(actorId: string, action: string, target: string) {
    super(`${actorId} may not ${action} ${target}`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Every read the platform does on behalf of a user — including the AI
 * butler's context assembly — goes through this class. The AI can only ever
 * see what the person asking could see themselves.
 */
export class AccessControl {
  private readonly memberships = new Map<string, Membership>();

  constructor(
    private readonly graph: HouseholdGraph,
    private readonly policies: Record<Role, RolePolicy> = DEFAULT_POLICIES,
  ) {}

  grant(userId: string, householdId: string, role: Role): Membership {
    const membership = { userId, householdId, role };
    this.memberships.set(key(userId, householdId), membership);
    return membership;
  }

  revoke(userId: string, householdId: string): void {
    this.memberships.delete(key(userId, householdId));
  }

  roleOf(userId: string, householdId: string): Role | undefined {
    return this.memberships.get(key(userId, householdId))?.role;
  }

  members(householdId: string): Membership[] {
    return [...this.memberships.values()].filter((m) => m.householdId === householdId);
  }

  domainAccess(userId: string, householdId: string, domain: Domain): Access {
    const role = this.roleOf(userId, householdId);
    if (!role) return 'none';
    return this.policies[role].domains[domain] ?? 'none';
  }

  canRead(actorId: string, node: GraphNode): boolean {
    return this.check(actorId, node, 'read');
  }

  canWrite(actorId: string, node: GraphNode): boolean {
    return this.check(actorId, node, 'write');
  }

  /** Whether the actor may create a node in this domain of the household. */
  canCreate(actorId: string, householdId: string, domain: Domain): boolean {
    return satisfies(this.domainAccess(actorId, householdId, domain), 'write');
  }

  assertCreate(actorId: string, householdId: string, domain: Domain): void {
    if (!this.canCreate(actorId, householdId, domain)) {
      throw new PermissionDeniedError(actorId, 'create in', `${domain} of ${householdId}`);
    }
  }

  assertRead(actorId: string, node: GraphNode): void {
    if (!this.canRead(actorId, node)) throw new PermissionDeniedError(actorId, 'read', node.id);
  }

  assertWrite(actorId: string, node: GraphNode): void {
    if (!this.canWrite(actorId, node)) throw new PermissionDeniedError(actorId, 'modify', node.id);
  }

  /** Nodes of a type the actor can see in a household. */
  visible<P extends Props = Props>(actorId: string, householdId: string, type: NodeType): GraphNode<P>[] {
    return this.graph.findByType<P>(householdId, type).filter((n) => this.canRead(actorId, n));
  }

  /** Permission-filtered traversal: hidden nodes are neither returned nor expanded. */
  traverseAs(actorId: string, startId: string, maxDepth = 2): Subgraph {
    return this.graph.traverse(startId, maxDepth, (n) => this.canRead(actorId, n));
  }

  private check(actorId: string, node: GraphNode, needed: 'read' | 'write'): boolean {
    if (node.ownerId === actorId) return true;
    if (node.visibility === 'private') {
      // Explicit shares grant read only; modification stays with the owner.
      return needed === 'read' && node.sharedWith.includes(actorId);
    }
    if (needed === 'read' && node.sharedWith.includes(actorId)) return true;

    const role = this.roleOf(actorId, node.householdId);
    if (!role) return false;
    const policy = this.policies[role];
    if (!satisfies(policy.domains[node.domain] ?? 'none', needed)) return false;
    if (policy.assignedOnly?.includes(node.domain)) {
      return this.graph.edgeBetween(node.id, 'assigned_to', actorId) !== undefined;
    }
    return true;
  }
}

const key = (userId: string, householdId: string) => `${householdId}::${userId}`;
