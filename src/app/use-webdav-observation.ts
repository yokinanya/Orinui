import { useEffect, useRef } from 'react';
import type { Database } from '@/storage/db';
import { observeWebDavLocal, type WebDavObservation } from '@/storage/webdav-observer';
import { isExtensionPage, subscribeWebDavConfiguration } from '@/platform/webdav-settings';
import { createWebDavScheduler } from '@/sync/webdav-scheduler';
import type { WebDavSyncService, WebDavSyncStatus } from '@/sync/webdav-types';
import type { useWebDavActions } from '@/app/use-webdav-actions';
import { notifyError } from '@/lib/notify';

interface ObservationInput {
  readonly db: Database;
  readonly service: WebDavSyncService;
  readonly refreshData: () => Promise<void>;
  readonly actions: ReturnType<typeof useWebDavActions>;
  readonly setLoading: (loading: boolean) => void;
  readonly setStatus: (status: WebDavSyncStatus | null) => void;
}

type Scheduler = ReturnType<typeof createWebDavScheduler>;

function isConnected(status: WebDavSyncStatus | null, observation: WebDavObservation): boolean {
  if (!status || !observation.state) return false;
  return Boolean(status.url) && status.vaultId === observation.state.vaultId && status.deviceId === observation.state.deviceId;
}

function appliedRunIdentity(observation: WebDavObservation): string | undefined {
  const run = observation.state?.lastSync;
  return run?.appliedAt === undefined ? undefined : run.runId;
}

function createRefresh(input: { readonly current: () => ObservationInput;
  readonly observation: () => WebDavObservation; readonly scheduler: Scheduler }) {
  let disposed = false;
  let revision = 0;
  let appliedRun: string | undefined;
  return {
    async update() {
      const version = ++revision;
      const observed = input.observation();
      try {
        const next = await input.current().service.read();
        if (disposed || version !== revision) return;
        input.current().setStatus(next);
        input.scheduler.observe(isConnected(next, observed) ? observed : { state: undefined, nextDeleteAt: undefined });
        const nextRun = appliedRunIdentity(observed);
        if (nextRun !== undefined && nextRun !== appliedRun) {
          appliedRun = nextRun;
          await input.current().refreshData();
        }
      } catch (cause) {
        if (!disposed) input.current().actions.setError(cause instanceof Error ? cause.message : String(cause));
      } finally { if (!disposed) input.current().setLoading(false); }
    },
    dispose() { disposed = true; },
  };
}

function subscribeConnection(current: () => ObservationInput): () => void {
  let latest: WebDavObservation = { state: undefined, nextDeleteAt: undefined };
  let identity: string | undefined;
  const scheduler = createWebDavScheduler({ now: Date.now,
    setTimer: (operation, delay) => setTimeout(operation, delay), clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    synchronize: async () => { await current().actions.run(() => current().service.syncNow(), true); }, onError: notifyError });
  const refresh = createRefresh({ current, observation: () => latest, scheduler });
  const unsubscribeLocal = observeWebDavLocal(current().db, { next(value) {
    const nextIdentity = value.state ? `${value.state.vaultId}:${value.state.deviceId}` : undefined;
    if (nextIdentity !== identity) { current().actions.cancelPlan(); identity = nextIdentity; }
    latest = value;
    void refresh.update();
  }, error(cause) { current().actions.setError(cause instanceof Error ? cause.message : String(cause)); } });
  const unsubscribeSettings = subscribeWebDavConfiguration(() => { current().actions.cancelPlan(); void refresh.update(); });
  if (!isExtensionPage()) void refresh.update();
  return () => { refresh.dispose(); scheduler.dispose(); unsubscribeLocal(); unsubscribeSettings(); };
}

export function useWebDavObservation(input: ObservationInput): void {
  const callbacks = useRef(input);
  callbacks.current = input;
  useEffect(() => subscribeConnection(() => callbacks.current), [input.db, input.service]);
}
