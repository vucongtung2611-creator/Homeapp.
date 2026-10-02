import type { Domain, GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export type IntegrationKind =
  | 'email'
  | 'calendar'
  | 'bank'
  | 'retailer'
  | 'delivery'
  | 'smart_home'
  | 'property_management'
  | 'shopping';

export interface IntegrationProps extends Record<string, unknown> {
  kind: IntegrationKind;
  provider: string;
  /** Domains this integration may write into. */
  scopes: Domain[];
  status: 'connected' | 'paused' | 'revoked';
  connectedAt: string;
}

/** What each kind of integration is allowed to touch by default. */
export const DEFAULT_SCOPES: Record<IntegrationKind, Domain[]> = {
  email: ['delivery', 'shopping', 'finance', 'documents'],
  calendar: ['calendar'],
  bank: ['finance'],
  retailer: ['shopping'],
  delivery: ['delivery'],
  smart_home: ['maintenance'],
  property_management: ['maintenance'],
  shopping: ['shopping'],
};

/**
 * Integrations are explicit, per-member grants. Not every service has an
 * API, and not every member wants every service connected, so each
 * connection records who connected it and which domains it may write.
 */
export class IntegrationRegistry {
  constructor(private readonly p: Platform) {}

  connect(
    actorId: string,
    householdId: string,
    input: { kind: IntegrationKind; provider: string; scopes?: Domain[] },
  ): GraphNode<IntegrationProps> {
    const scopes = input.scopes ?? DEFAULT_SCOPES[input.kind];
    for (const domain of scopes) this.p.acl.assertCreate(actorId, householdId, domain);
    return this.p.graph.addNode<IntegrationProps>({
      type: 'integration',
      householdId,
      domain: 'core',
      label: `${input.provider} (${input.kind})`,
      ownerId: actorId,
      visibility: 'private',
      props: { kind: input.kind, provider: input.provider, scopes, status: 'connected', connectedAt: this.p.now().toISOString() },
    });
  }

  setStatus(actorId: string, integrationId: string, status: IntegrationProps['status']): void {
    const node = this.p.graph.requireNode<IntegrationProps>(integrationId);
    this.p.acl.assertWrite(actorId, node);
    this.p.graph.updateNode<IntegrationProps>(integrationId, { status });
  }

  allows(integrationId: string, domain: Domain): boolean {
    const node = this.p.graph.getNode<IntegrationProps>(integrationId);
    return node?.props.status === 'connected' && node.props.scopes.includes(domain);
  }

  list(actorId: string, householdId: string): GraphNode<IntegrationProps>[] {
    return this.p.acl.visible<IntegrationProps>(actorId, householdId, 'integration');
  }
}
