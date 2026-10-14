import { useState } from 'react';
import type { WebDavSyncService, WebDavConnectionPlan } from '@/sync/webdav-types';
import { useWebDavOperation } from '@/app/use-webdav-operation';
import { WebDavRecoveryRequiredError } from '@/sync/webdav-recovery-required';

export function useWebDavActions(input: { readonly service: WebDavSyncService;
  readonly refresh: () => Promise<void>; readonly refreshData: () => Promise<void> }) {
  const [plan, setPlan] = useState<WebDavConnectionPlan | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const { busy, error, setError, run } = useWebDavOperation(input);
  const { service } = input;
  return { busy, error, plan, setError, recoveryRequired,
    prepare: (value: Parameters<WebDavSyncService['prepare']>[0]) => {
      setPlan(null);
      setRecoveryRequired(false);
      const preparation = service.prepare(value).catch((cause: unknown) => {
        setRecoveryRequired(cause instanceof WebDavRecoveryRequiredError); throw cause;
      });
      return run(async () => { setPlan(await preparation); });
    },
    connect: () => run(async () => { try { await service.connect(); } finally { setPlan(null); } }),
    cancelPlan: () => { service.cancelPlan(); setPlan(null); setError(null); setRecoveryRequired(false); },
    resetRemote: () => run(async () => { await service.resetRemote(); setRecoveryRequired(false); }),
    syncNow: () => run(() => service.syncNow()),
    disconnect: () => run(async () => { await service.disconnect(); setPlan(null); }),
    run,
  };
}
