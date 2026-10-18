import { useCallback, useMemo, type ReactNode } from 'react';
import { isDarkActive } from '@/app/apply-appearance';
import { createDataCommands, imageReader } from '@/app/data-commands';
import { DataContext, type DataContextValue } from '@/app/data-context';
import { useSystemPrefersDark } from '@/app/theme';
import { useDataState } from '@/app/use-data-state';
import { db } from '@/storage/db';
import { listFolderShortcuts } from '@/storage/shortcuts';
import { readSettings } from '@/storage/settings';
import { WebDavSyncProvider } from '@/app/WebDavSyncProvider';
import { S3SyncProvider } from '@/app/S3SyncProvider';
import { useOperations } from '@/app/operations';
import { withOperationFeedback } from '@/app/operation-feedback';

/** 数据桥把存储实例注入状态加载与操作模块，界面只访问 useData。 */
export function DataProvider({ children }: { readonly children: ReactNode }) {
  const state = useDataState(db);
  const systemPrefersDark = useSystemPrefersDark();
  const readMediaAsset = useMemo(() => imageReader(db), []);
  const operations = useOperations();
  const { status, error, folders, shortcuts, settings, loadFolders, loadShortcuts, setSettings } = state;
  const commands = useMemo(() => createDataCommands({ db, loadFolders, loadShortcuts, setSettings }),
    [loadFolders, loadShortcuts, setSettings]);
  const reportedCommands = useMemo(() => withOperationFeedback(commands, operations.begin), [commands, operations.begin]);
  const loadFolderShortcuts = useCallback((folderId: string) => listFolderShortcuts(db, folderId), []);
  const refreshData = useCallback(async () => {
    await loadFolders();
    setSettings(await readSettings(db));
    await loadShortcuts();
  }, [loadFolders, setSettings, loadShortcuts]);
  const value = useMemo<DataContextValue>(() => ({
    status, error, folders, shortcuts, settings, loadFolderShortcuts,
    readMediaAsset,
    isDark: isDarkActive(settings.appearance.theme, systemPrefersDark),
    ...reportedCommands,
  }), [status, error, folders, shortcuts, settings, loadFolderShortcuts, readMediaAsset, systemPrefersDark, reportedCommands]);
  return <DataContext value={value}><WebDavSyncProvider db={db} refreshData={refreshData}>
    <S3SyncProvider db={db} refreshData={refreshData}>{children}</S3SyncProvider>
  </WebDavSyncProvider></DataContext>;
}