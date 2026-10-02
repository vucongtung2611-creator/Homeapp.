import { randomUUID } from 'node:crypto';
import type { GraphEdge, GraphNode, NewNode, NodeType, Props, Relation } from './types.js';

export type Direction = 'out' | 'in' | 'both';

export interface NeighborQuery {
  relation?: Relation;
  direction?: Direction;
  type?: NodeType;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type NodeFilter = (node: GraphNode) => boolean;

/** JSON-safe form of a graph, used for persistence. */
export interface GraphSnapshot {
  version: 1;
  nodes: (Omit<GraphNode, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string })[];
  edges: (Omit<GraphEdge, 'createdAt'> & { createdAt: string })[];
}

/**
 * In-memory property graph. The storage engine is intentionally simple: the
 * public API is what the rest of the platform depends on, so it can later be
 * backed by Postgres, Neo4j or similar without changing the modules.
 */
export class HouseholdGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  now(): Date {
    return this.clock();
  }

  addNode<P extends Props>(input: NewNode<P>): GraphNode<P> {
    const id = input.id ?? randomUUID();
    if (this.nodes.has(id)) throw new Error(`Node ${id} already exists`);
    const now = this.clock();
    const node: GraphNode<P> = {
      id,
      type: input.type,
      householdId: input.householdId,
      domain: input.domain,
      label: input.label,
      props: (input.props ?? {}) as P,
      ownerId: input.ownerId,
      visibility: input.visibility ?? 'household',
      sharedWith: [...(input.sharedWith ?? [])],
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(id, node as GraphNode);
    this.outgoing.set(id, new Set());
    this.incoming.set(id, new Set());
    return node;
  }

  getNode<P extends Props = Props>(id: string): GraphNode<P> | undefined {
    return this.nodes.get(id) as GraphNode<P> | undefined;
  }

  requireNode<P extends Props = Props>(id: string): GraphNode<P> {
    const node = this.getNode<P>(id);
    if (!node) throw new Error(`Node ${id} not found`);
    return node;
  }

  updateNode<P extends Props>(id: string, patch: Partial<P>, label?: string): GraphNode<P> {
    const node = this.requireNode<P>(id);
    node.props = { ...node.props, ...patch };
    if (label !== undefined) node.label = label;
    node.updatedAt = this.clock();
    return node;
  }

  share(id: string, userId: string): void {
    const node = this.requireNode(id);
    if (!node.sharedWith.includes(userId)) node.sharedWith.push(userId);
  }

  unshare(id: string, userId: string): void {
    const node = this.requireNode(id);
    node.sharedWith = node.sharedWith.filter((u) => u !== userId);
  }

  removeNode(id: string): void {
    for (const edgeId of [...(this.outgoing.get(id) ?? []), ...(this.incoming.get(id) ?? [])]) {
      this.removeEdge(edgeId);
    }
    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
  }

  /** Create `from -[relation]-> to`. Idempotent for the same triple. */
  link(from: string, relation: Relation, to: string, props?: Props): GraphEdge {
    this.requireNode(from);
    this.requireNode(to);
    const existing = this.edgeBetween(from, relation, to);
    if (existing) return existing;
    const edge: GraphEdge = { id: randomUUID(), from, to, relation, createdAt: this.clock(), props };
    this.edges.set(edge.id, edge);
    this.outgoing.get(from)!.add(edge.id);
    this.incoming.get(to)!.add(edge.id);
    return edge;
  }

  unlink(from: string, relation: Relation, to: string): void {
    const edge = this.edgeBetween(from, relation, to);
    if (edge) this.removeEdge(edge.id);
  }

  edgeBetween(from: string, relation: Relation, to: string): GraphEdge | undefined {
    for (const edgeId of this.outgoing.get(from) ?? []) {
      const edge = this.edges.get(edgeId)!;
      if (edge.relation === relation && edge.to === to) return edge;
    }
    return undefined;
  }

  edgesOf(id: string, direction: Direction = 'both'): GraphEdge[] {
    const ids = new Set<string>();
    if (direction !== 'in') for (const e of this.outgoing.get(id) ?? []) ids.add(e);
    if (direction !== 'out') for (const e of this.incoming.get(id) ?? []) ids.add(e);
    return [...ids].map((e) => this.edges.get(e)!);
  }

  neighbors<P extends Props = Props>(id: string, query: NeighborQuery = {}): GraphNode<P>[] {
    const { relation, direction = 'both', type } = query;
    const result: GraphNode<P>[] = [];
    const seen = new Set<string>();
    for (const edge of this.edgesOf(id, direction)) {
      if (relation && edge.relation !== relation) continue;
      const otherId = edge.from === id ? edge.to : edge.from;
      if (seen.has(otherId)) continue;
      const other = this.nodes.get(otherId)!;
      if (type && other.type !== type) continue;
      seen.add(otherId);
      result.push(other as GraphNode<P>);
    }
    return result;
  }

  /**
   * Breadth-first walk from `startId`, used to assemble context ("everything
   * connected to this milk carton within two hops"). `filter` lets callers
   * prune nodes the viewer may not see; pruned nodes are not expanded.
   */
  traverse(startId: string, maxDepth = 2, filter: NodeFilter = () => true): Subgraph {
    const start = this.requireNode(startId);
    if (!filter(start)) return { nodes: [], edges: [] };
    const visited = new Map<string, GraphNode>([[start.id, start]]);
    const edges = new Map<string, GraphEdge>();
    let frontier = [start.id];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of this.edgesOf(id)) {
          const otherId = edge.from === id ? edge.to : edge.from;
          const other = this.nodes.get(otherId)!;
          if (!filter(other)) continue;
          edges.set(edge.id, edge);
          if (!visited.has(otherId)) {
            visited.set(otherId, other);
            next.push(otherId);
          }
        }
      }
      frontier = next;
    }
    return { nodes: [...visited.values()], edges: [...edges.values()] };
  }

  find<P extends Props = Props>(predicate: (node: GraphNode<P>) => boolean): GraphNode<P>[] {
    return [...this.nodes.values()].filter((n) => predicate(n as GraphNode<P>)) as GraphNode<P>[];
  }

  findByType<P extends Props = Props>(householdId: string, type: NodeType): GraphNode<P>[] {
    return this.find<P>((n) => n.householdId === householdId && n.type === type);
  }

  /** Case-insensitive label lookup within a household, used for de-duplication. */
  findByLabel<P extends Props = Props>(
    householdId: string,
    type: NodeType,
    label: string,
  ): GraphNode<P> | undefined {
    const needle = label.trim().toLowerCase();
    return this.find<P>(
      (n) => n.householdId === householdId && n.type === type && n.label.trim().toLowerCase() === needle,
    )[0];
  }

  toJSON(): GraphSnapshot {
    return {
      version: 1,
      nodes: [...this.nodes.values()].map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
      edges: [...this.edges.values()].map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  }

  static fromJSON(snapshot: GraphSnapshot, clock?: () => Date): HouseholdGraph {
    const graph = new HouseholdGraph(clock);
    for (const n of snapshot.nodes) {
      graph.nodes.set(n.id, { ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) });
      graph.outgoing.set(n.id, new Set());
      graph.incoming.set(n.id, new Set());
    }
    for (const e of snapshot.edges) {
      graph.edges.set(e.id, { ...e, createdAt: new Date(e.createdAt) });
      graph.outgoing.get(e.from)?.add(e.id);
      graph.incoming.get(e.to)?.add(e.id);
    }
    return graph;
  }

  get size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }

  private removeEdge(edgeId: string): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.outgoing.get(edge.from)?.delete(edgeId);
    this.incoming.get(edge.to)?.delete(edgeId);
    this.edges.delete(edgeId);
  }
}
