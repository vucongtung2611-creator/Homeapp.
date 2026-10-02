type Setter = (p: string) => void;
let setPath: Setter = () => {};

export function bindRouter(setter: Setter) {
  setPath = setter;
}

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  setPath(location.pathname + location.search);
  window.scrollTo(0, 0);
}

addEventListener('popstate', () => setPath(location.pathname + location.search));

/** Shared shape of the realtime fan-out given to every screen. */
export type Listener = (event: { type: string; [k: string]: any }) => void;
export interface Live {
  on(fn: Listener): () => void;
  connected: boolean;
  /** Disconnected on purpose after a while without activity; any tap or key resumes. */
  paused: boolean;
}

export interface Session {
  user: { id: string; email: string; name: string; avatar: string } | null;
  households: { id: string; name: string; role: string }[];
  /** Server settings, e.g. how long chat stays connected without activity. */
  config?: { chatIdleMinutes: number };
  refresh: () => Promise<void>;
}
