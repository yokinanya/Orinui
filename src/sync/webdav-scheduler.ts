import type { WebDavObservation } from '@/storage/webdav-observer';

interface SchedulerDependencies {
  readonly synchronize: () => Promise<void>;
  readonly onError: (cause: unknown) => void;
  readonly now: () => number;
  readonly setTimer: (operation: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

/** Events and the nearest undo expiry drive synchronization; there is no polling or retry timer. */
export function createWebDavScheduler(deps: SchedulerDependencies) {
  let identity: string | undefined;
  let generation: number | undefined;
  let deadline: number | undefined;
  let timer: unknown;
  let running = false;
  let queued = false;
  let disposed = false;

  const request = async () => {
    if (disposed) return;
    if (running) { queued = true; return; }
    running = true;
    try { await deps.synchronize(); }
    catch (cause) { deps.onError(cause); }
    finally {
      running = false;
      if (queued) { queued = false; void request(); }
    }
  };
  const clearDeadline = () => {
    if (timer !== undefined) deps.clearTimer(timer);
    timer = undefined;
    deadline = undefined;
  };
  return {
    observe(value: WebDavObservation) {
      const state = value.state;
      if (!state) { identity = undefined; generation = undefined; queued = false; clearDeadline(); return; }
      const nextIdentity = `${state.vaultId}:${state.deviceId}`;
      const opened = identity !== nextIdentity;
      const edited = generation !== state.generation && (state.lastSync?.appliedGeneration === undefined
        || state.generation > state.lastSync.appliedGeneration);
      identity = nextIdentity;
      generation = state.generation;
      if (opened || edited) void request();
      if (deadline === value.nextDeleteAt) return;
      clearDeadline();
      deadline = value.nextDeleteAt;
      if (deadline !== undefined) timer = deps.setTimer(() => { timer = undefined; void request(); }, Math.max(0, deadline - deps.now()));
    },
    dispose() { disposed = true; queued = false; clearDeadline(); },
  };
}
