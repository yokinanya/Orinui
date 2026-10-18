import { useCallback, useRef, useState } from 'react';
import { notifyError } from '@/lib/notify';
import { reportSyncProgress, useOperations } from '@/app/operations';
import type { OperationHandle } from '@/app/operations';
import type { SyncProgressReporter } from '@/sync/ports';

export function useWebDavOperation(input: { readonly refresh: () => Promise<void>; readonly refreshData: () => Promise<void> }) {
  const operationCenter = useOperations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pending = useRef(0);
  const { refresh, refreshData } = input;
  const execute = useCallback(async (operation: (reportProgress: SyncProgressReporter) => Promise<unknown>, announce: boolean,
    task: OperationHandle): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let succeeded = false;
    try { await operation((event) => reportSyncProgress(task, event)); succeeded = true; }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      if (announce) notifyError(cause);
      task.fail(cause);
    }
    try { await refresh(); await refreshData(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError((previous) => previous ? `${previous}；读取最新状态失败：${message}` : message);
      task.fail(cause);
      succeeded = false;
    }
    finally {
      pending.current -= 1;
      setBusy(pending.current > 0);
      if (succeeded) task.succeed('操作完成');
    }
    return succeeded;
  }, [refresh, refreshData]);
  const run = useCallback((operation: (reportProgress: SyncProgressReporter) => Promise<unknown>, announce = false,
    label = 'WebDAV 同步操作'): Promise<boolean> => {
    const task = operationCenter.begin(label, pending.current > 0 ? '等待其他操作' : '准备操作');
    pending.current += 1;
    setBusy(true);
    const result = queue.current.then(() => { task.update('正在处理'); return execute(operation, announce, task); });
    queue.current = result;
    return result;
  }, [execute, operationCenter]);
  return { busy, error, setError, run };
}
