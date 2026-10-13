import { useCallback, useRef, useState } from 'react';
import type { WebDavSyncService, WebDavConnectionPlan } from '@/sync/webdav-types';
import { notifyError } from '@/lib/notify';

export function useWebDavActions(input: { readonly service: WebDavSyncService;
  readonly refresh: () => Promise<void>; readonly refreshData: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<WebDavConnectionPlan | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pending = useRef(0);
  const { service, refresh, refreshData } = input;
  const execute = useCallback(async (operation: () => Promise<unknown>, announce: boolean): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let succeeded = false;
    try { await operation(); succeeded = true; }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      if (announce) notifyError(cause);
    }
    try { await refresh(); await refreshData(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError((previous) => previous ? `${previous}；读取最新状态失败：${message}` : message);
      succeeded = false;
    }
    finally { pending.current -= 1; setBusy(pending.current > 0); }
    return succeeded;
  }, [refresh, refreshData]);
  const run = useCallback((operation: () => Promise<unknown>, announce = false): Promise<boolean> => {
    pending.current += 1;
    setBusy(true);
    const result = queue.current.then(() => execute(operation, announce));
    queue.current = result;
    return result;
  }, [execute]);
  return { busy, error, plan, setError,
    prepare: (value: Parameters<WebDavSyncService['prepare']>[0]) => {
      setPlan(null);
      const preparation = service.prepare(value);
      return run(async () => { setPlan(await preparation); });
    },
    connect: () => run(async () => { try { await service.connect(); } finally { setPlan(null); } }),
    cancelPlan: () => { service.cancelPlan(); setPlan(null); setError(null); },
    syncNow: () => run(() => service.syncNow()),
    disconnect: () => run(async () => { await service.disconnect(); setPlan(null); }),
    run,
  };
}
