import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Database } from '@/storage/db';
import { requestWebDavPermission } from '@/platform/webdav-settings';
import type { WebDavSyncStatus } from '@/sync/webdav-types';
import { createWebDavRuntime } from '@/app/webdav-runtime';
import { WebDavSyncContext, type WebDavSyncContextValue } from '@/app/webdav-sync-context';
import { useWebDavActions } from '@/app/use-webdav-actions';
import { useWebDavObservation } from '@/app/use-webdav-observation';

interface ProviderProps {
  readonly children: ReactNode;
  readonly db: Database;
  readonly refreshData: () => Promise<void>;
}

export function WebDavSyncProvider({ children, db, refreshData }: ProviderProps) {
  const service = useMemo(() => createWebDavRuntime(db), [db]);
  const [status, setStatus] = useState<WebDavSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setStatus(await service.read()); }, [service]);
  const actions = useWebDavActions({ service, refresh, refreshData });
  useWebDavObservation({ db, service, refreshData, actions, setLoading, setStatus });
  const visibleStatus: WebDavSyncStatus | null = status && actions.error
    ? { ...status, state: 'error', error: actions.error } : status;
  const value: WebDavSyncContextValue = { status: visibleStatus, loading, busy: actions.busy || visibleStatus?.state === 'syncing',
    error: actions.error, plan: actions.plan, prepare: actions.prepare, connect: actions.connect,
    cancelPlan: actions.cancelPlan, disconnect: actions.disconnect,
    recoveryRequired: actions.recoveryRequired, resetRemote: actions.resetRemote,
    deleteRemote: () => {
      const permission = status ? requestWebDavPermission(status.url) : Promise.reject(new Error('尚未连接 WebDAV 同步'));
      return actions.run(async () => { await permission; await service.deleteRemote(); });
    },
    syncNow: () => {
      const permission = status ? requestWebDavPermission(status.url) : Promise.reject(new Error('尚未连接 WebDAV 同步'));
      return actions.run(async () => { await permission; await service.syncNow(); });
    } };
  return <WebDavSyncContext value={value}>{children}</WebDavSyncContext>;
}
