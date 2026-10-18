import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Database } from '@/storage/db';
import { createS3Runtime } from '@/app/s3-runtime';
import { useOperations, reportSyncProgress } from '@/app/operations';
import { S3SyncContextProvider } from '@/app/s3-sync-context';
import { useS3Actions } from '@/app/use-s3-actions';
import { useS3SyncObservation } from '@/app/use-s3-sync-observation';
import type { S3SyncStatus } from '@/sync/s3-types';
import type { SyncTransferEvent } from '@/sync/ports';

interface ProviderProps { readonly children: ReactNode; readonly db: Database; readonly refreshData: () => Promise<void> }

export function S3SyncProvider({ children, db, refreshData }: ProviderProps) {
  const service = useMemo(() => createS3Runtime(db), [db]);
  const operations = useOperations();
  const [status, setStatus] = useState<S3SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => setStatus(await service.read()), [service]);
  const run = useS3OperationRunner({ operations, refresh, refreshData, setBusy, setError });
  useS3SyncObservation({ db, service, run, refreshData, setStatus, setError, setLoading });
  const value = useS3Actions({ service, operations, status, loading, busy, error, setError, run });
  return <S3SyncContextProvider value={value}>{children}</S3SyncContextProvider>;
}

interface OperationRunnerInput {
  readonly operations: ReturnType<typeof useOperations>;
  readonly refresh: () => Promise<void>;
  readonly refreshData: () => Promise<void>;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: string | null) => void;
}

export function useS3OperationRunner(input: OperationRunnerInput) {
  return useCallback(async (label: string, action: (progress: (event: SyncTransferEvent) => void) => Promise<void>,
    refreshDataAfter = false): Promise<boolean> => {
    input.setBusy(true); input.setError(null);
    const task = input.operations.begin(label, '准备 S3 操作');
    try {
      await action((event) => reportSyncProgress(task, event));
      if (refreshDataAfter) await input.refreshData();
      task.succeed('操作完成');
      return true;
    } catch (cause) {
      task.fail(cause); input.setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      try { await input.refresh(); }
      catch (cause) { input.setError(cause instanceof Error ? cause.message : String(cause)); }
      input.setBusy(false);
    }
  }, [input]);
}
