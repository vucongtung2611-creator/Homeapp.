import type { GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export type IssueStatus = 'reported' | 'acknowledged' | 'assigned' | 'in_progress' | 'resolved';

export interface IssueProps extends Record<string, unknown> {
  description: string;
  status: IssueStatus;
  reportedAt: string;
  history: { status: IssueStatus; at: string; by: string; note?: string }[];
}

/**
 * Tenants report issues with photos; property managers and contractors work
 * them. Everything here lives in the `maintenance` domain, which is the only
 * domain a property manager can see.
 */
export class Maintenance {
  constructor(private readonly p: Platform) {}

  reportIssue(
    actorId: string,
    householdId: string,
    input: { title: string; description: string; roomId?: string; itemId?: string; photos?: string[] },
  ): GraphNode<IssueProps> {
    this.p.acl.assertCreate(actorId, householdId, 'maintenance');
    const at = this.p.now().toISOString();
    const issue = this.p.graph.addNode<IssueProps>({
      type: 'issue',
      householdId,
      domain: 'maintenance',
      label: input.title,
      ownerId: actorId,
      props: {
        description: input.description,
        status: 'reported',
        reportedAt: at,
        history: [{ status: 'reported', at, by: actorId }],
      },
    });
    this.p.graph.link(issue.id, 'reported_by', actorId);
    if (input.roomId) this.p.graph.link(issue.id, 'located_in', input.roomId);
    if (input.itemId) this.p.graph.link(issue.id, 'about', input.itemId);
    for (const uri of input.photos ?? []) {
      const photo = this.p.graph.addNode({
        type: 'document',
        householdId,
        domain: 'maintenance',
        label: 'Issue photo',
        ownerId: actorId,
        props: { uri, kind: 'photo' },
      });
      this.p.graph.link(issue.id, 'evidenced_by', photo.id);
    }
    return issue;
  }

  assign(actorId: string, issueId: string, contractorId: string): GraphNode<IssueProps> {
    const issue = this.p.graph.requireNode<IssueProps>(issueId);
    this.p.acl.assertWrite(actorId, issue);
    this.p.graph.link(issue.id, 'assigned_to', contractorId);
    // The contractor also needs to see the evidence for the job.
    for (const photo of this.p.graph.neighbors(issue.id, { relation: 'evidenced_by', direction: 'out' })) {
      this.p.graph.link(photo.id, 'assigned_to', contractorId);
    }
    return this.transition(actorId, issue, 'assigned', `Assigned to ${contractorId}`);
  }

  updateStatus(actorId: string, issueId: string, status: IssueStatus, note?: string): GraphNode<IssueProps> {
    const issue = this.p.graph.requireNode<IssueProps>(issueId);
    this.p.acl.assertWrite(actorId, issue);
    return this.transition(actorId, issue, status, note);
  }

  issues(actorId: string, householdId: string, options: { open?: boolean } = {}): GraphNode<IssueProps>[] {
    return this.p.acl
      .visible<IssueProps>(actorId, householdId, 'issue')
      .filter((i) => !options.open || i.props.status !== 'resolved');
  }

  /** Repair history of a room or an asset (e.g. the dishwasher). */
  history(actorId: string, roomOrItemId: string): GraphNode<IssueProps>[] {
    return this.p.graph
      .neighbors<IssueProps>(roomOrItemId, { direction: 'in', type: 'issue' })
      .filter((i) => this.p.acl.canRead(actorId, i))
      .sort((a, b) => a.props.reportedAt.localeCompare(b.props.reportedAt));
  }

  private transition(actorId: string, issue: GraphNode<IssueProps>, status: IssueStatus, note?: string) {
    return this.p.graph.updateNode<IssueProps>(issue.id, {
      status,
      history: [...issue.props.history, { status, at: this.p.now().toISOString(), by: actorId, note }],
    });
  }
}
