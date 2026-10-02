import { ALL_DOMAINS, type Domain } from '../graph/types.js';

export type Role =
  | 'owner'
  | 'family_member'
  | 'child'
  | 'tenant'
  | 'guest'
  | 'property_manager'
  | 'cleaner'
  | 'contractor'
  | 'service_provider';

export type Access = 'none' | 'read' | 'write';

export interface RolePolicy {
  domains: Partial<Record<Domain, Access>>;
  /**
   * When set, the role only sees nodes in these domains that are directly
   * assigned to it (`node -[assigned_to]-> person`), e.g. a contractor sees
   * the jobs they were given, not every issue in the house.
   */
  assignedOnly?: Domain[];
}

const all = (access: Access): Partial<Record<Domain, Access>> =>
  Object.fromEntries(ALL_DOMAINS.map((d) => [d, access]));

/**
 * Least-privilege defaults. Anything not listed is `none`. Private nodes are
 * never reachable through a role — only through ownership or an explicit share.
 */
export const DEFAULT_POLICIES: Record<Role, RolePolicy> = {
  owner: { domains: all('write') },
  family_member: { domains: all('write') },
  child: {
    domains: {
      core: 'read',
      kitchen: 'read',
      calendar: 'write',
      communication: 'write',
      shopping: 'read',
      wardrobe: 'write',
      maintenance: 'write',
      library: 'read',
    },
  },
  tenant: {
    domains: {
      core: 'write',
      kitchen: 'write',
      finance: 'write',
      delivery: 'write',
      shopping: 'write',
      maintenance: 'write',
      calendar: 'write',
      communication: 'write',
      documents: 'read',
      wardrobe: 'write',
      library: 'write',
    },
  },
  guest: { domains: { core: 'read', calendar: 'read', communication: 'write' } },
  property_manager: { domains: { core: 'read', maintenance: 'write' } },
  cleaner: { domains: { core: 'read', maintenance: 'read' }, assignedOnly: ['maintenance'] },
  contractor: { domains: { core: 'read', maintenance: 'write' }, assignedOnly: ['maintenance'] },
  service_provider: { domains: { delivery: 'read' }, assignedOnly: ['delivery'] },
};

const rank: Record<Access, number> = { none: 0, read: 1, write: 2 };

export function satisfies(granted: Access, needed: Exclude<Access, 'none'>): boolean {
  return rank[granted] >= rank[needed];
}
