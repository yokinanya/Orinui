import { useEffect, useRef } from 'react';
import type { Database } from '@/storage/db';
import { observeWebDavLocal, type WebDavObservation } from '@/storage/webdav-observer';
import { createWebDavScheduler } from '@/sync/webdav-scheduler';
import { isExtensionPage } from '@/platform/webdav-settings';
import { subscribeS3Configuration } from '@/platform/s3-settings';
import type { S3SyncService } from '@/sync/s3-types';
import type { S3SyncStatus } from '@/sync/s3-types';
import type { SyncTransferEvent } from '@/sync/ports';

type RunOperation = (label: string, action: (report: (event: SyncTransferEvent) => void) => Promise<void>,
  refreshData?: boolean) => Promise<boolean>;
interface ObservationInput {
  readonly db: Database;
  readonly service: S3SyncService;
  readonly run: RunOperation;
  readonly refreshData: () => Promise<void>;
  readonly setStatus: (value: S3SyncStatus | null) => void;
  readonly setError: (value: string | null) => void;
  readonly setLoading: (value: boolean) => void;
}

function sameConnection(status: S3SyncStatus | null, observation: WebDavObservation): boolean {
  return Boolean(status && observation.state && status.vaultId === observation.state.vaultId
    && status.deviceId === observation.state.deviceId);
}

function isLatestUpdate(disposed: boolean, version: number, revision: number): boolean {
  return !disposed && version === revision;
}

function appliedRunId(status: S3SyncStatus | null, observation: WebDavObservation): string | undefined {
  if (!sameConnection(status, observation)) return undefined;
  const run = observation.state?.lastSync;
  return run?.appliedAt === undefined ? undefined : run.runId;
}

function createS3Refresh(input: { readonly current: () => ObservationInput; readonly latest: () => WebDavObservation;
  readonly scheduler: ReturnType<typeof createWebDavScheduler> }) {
  let disposed = false;
  let revision = 0;
  let appliedRun: string | undefined;
  return {
    async update() {
      const version = ++revision;
      const observation = input.latest();
      try {
        const status = await input.current().service.read();
        if (!isLatestUpdate(disposed, version, revision)) return;
        input.current().setStatus(status);
        input.scheduler.observe(sameConnection(status, observation) ? observation
          : { state: undefined, nextDeleteAt: undefined });
        const nextAppliedRun = appliedRunId(status, observation);
        if (nextAppliedRun && nextAppliedRun !== appliedRun) {
          appliedRun = nextAppliedRun;
          await input.current().refreshData();
        }
      } catch (cause) {
        if (!disposed) input.current().setError(cause instanceof Error ? cause.message : String(cause));
      } finally { if (!disposed) input.current().setLoading(false); }
    },
    dispose() { disposed = true; },
  };
}

function subscribeS3(input: ObservationInput): () => void {
  let latest: WebDavObservation = { state: undefined, nextDeleteAt: undefined };
  let identity: string | undefined;
  const scheduler = createWebDavScheduler({ now: Date.now,
    setTimer: (operation, delay) => setTimeout(operation, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    synchronize: async () => { await input.run('自动同步 S3 数据', async (report) => { await input.service.syncNow(report); }); },
    onError: (cause) => input.setError(cause instanceof Error ? cause.message : String(cause)) });
  const refresh = createS3Refresh({ current: () => input, latest: () => latest, scheduler });
  const removeLocal = observeWebDavLocal(input.db, { next(value) {
    const nextIdentity = value.state ? `${value.state.vaultId}:${value.state.deviceId}` : undefined;
    if (nextIdentity !== identity) { input.service.cancelPlan(); identity = nextIdentity; }
    latest = value;
    void refresh.update();
  }, error(cause) { input.setError(cause instanceof Error ? cause.message : String(cause)); } });
  const removeConfiguration = subscribeS3Configuration(() => { input.service.cancelPlan(); void refresh.update(); });
  void refresh.update();
  return () => { refresh.dispose(); scheduler.dispose(); removeLocal(); removeConfiguration(); };
}

export function useS3SyncObservation(input: ObservationInput): void {
  const current = useRef(input);
  current.current = input;
  useEffect(() => {
    if (!isExtensionPage()) { current.current.setLoading(false); return; }
    const latest = () => current.current;
    return subscribeS3({ db: input.db, service: input.service,
      run: (...args) => latest().run(...args), refreshData: () => latest().refreshData(),
      setStatus: (status) => latest().setStatus(status), setError: (error) => latest().setError(error),
      setLoading: (loading) => latest().setLoading(loading) });
  }, [input.db, input.service]);
}
