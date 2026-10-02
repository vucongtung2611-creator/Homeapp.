import type { Domain, GraphNode } from '../graph/types.js';
import type { Platform } from '../platform.js';

export interface TaskProps extends Record<string, unknown> {
  dueOn?: string; // ISO date
  status: 'open' | 'done';
  /** Node the task is about (bill, issue, recipe...). */
  subjectId?: string;
}

export interface EventProps extends Record<string, unknown> {
  start: string; // ISO date-time
  guests?: number;
  /** Dietary requirements of external guests, e.g. ["vegetarian"]. */
  guestDiet?: string[];
}

/** Shared tasks and household calendar. */
export class Coordination {
  constructor(private readonly p: Platform) {}

  createTask(
    actorId: string,
    householdId: string,
    input: { title: string; domain: Domain; dueOn?: string; assignees?: string[]; subjectId?: string },
  ): GraphNode<TaskProps> {
    this.p.acl.assertCreate(actorId, householdId, input.domain);
    const task = this.p.graph.addNode<TaskProps>({
      type: 'task',
      householdId,
      domain: input.domain,
      label: input.title,
      ownerId: actorId,
      props: { status: 'open', dueOn: input.dueOn, subjectId: input.subjectId },
    });
    for (const userId of input.assignees ?? []) this.p.graph.link(task.id, 'assigned_to', userId);
    if (input.subjectId) this.p.graph.link(task.id, 'about', input.subjectId);
    return task;
  }

  complete(actorId: string, taskId: string): void {
    const task = this.p.graph.requireNode<TaskProps>(taskId);
    const assigned = this.p.graph.edgeBetween(taskId, 'assigned_to', actorId) !== undefined;
    if (!assigned) this.p.acl.assertWrite(actorId, task);
    this.p.graph.updateNode<TaskProps>(taskId, { status: 'done' });
  }

  /** Open tasks assigned to a user that they are allowed to see. */
  tasksFor(actorId: string, householdId: string): GraphNode<TaskProps>[] {
    return this.p.acl
      .visible<TaskProps>(actorId, householdId, 'task')
      .filter((t) => t.props.status === 'open' && this.p.graph.edgeBetween(t.id, 'assigned_to', actorId))
      .sort((a, b) => (a.props.dueOn ?? '9999').localeCompare(b.props.dueOn ?? '9999'));
  }

  addEvent(
    actorId: string,
    householdId: string,
    input: { title: string; start: string; guests?: number; guestDiet?: string[]; attendees?: string[] },
  ): GraphNode<EventProps> {
    this.p.acl.assertCreate(actorId, householdId, 'calendar');
    const event = this.p.graph.addNode<EventProps>({
      type: 'event',
      householdId,
      domain: 'calendar',
      label: input.title,
      ownerId: actorId,
      props: { start: input.start, guests: input.guests, guestDiet: input.guestDiet },
    });
    for (const userId of input.attendees ?? []) this.p.graph.link(userId, 'attending', event.id);
    return event;
  }

  eventsOn(actorId: string, householdId: string, date: string): GraphNode<EventProps>[] {
    return this.p.acl
      .visible<EventProps>(actorId, householdId, 'event')
      .filter((e) => e.props.start.slice(0, 10) === date)
      .sort((a, b) => a.props.start.localeCompare(b.props.start));
  }
}
