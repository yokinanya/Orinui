import { useCallback, useMemo, type ReactNode } from 'react';
import { isDarkActive } from '@/app/apply-appearance';
import { createDataCommands, imageReader } from '@/app/data-commands';
import { DataContext, type DataContextValue } from '@/app/data-context';
import { useSystemPrefersDark } from '@/app/theme';
import { useDataState } from '@/app/use-data-state';
import { db } from '@/storage/db';
import { observeBookmarkPreferences } from '@/storage/bookmark-preferences-observer';
import { listFolderShortcuts } from '@/storage/shortcuts';
import { readSettings } from '@/storage/settings';
import { changeWidgetHeight, moveHomeItem, saveWidget, deleteWidget } from '@/storage/home';
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
  // 只读书签偏好观察：注入到 DataContext，供书签运行时按跨页提交应用偏好。
  // 它以既有 settings 行为唯一来源，不改数据加载路径，也不扩成全库实时刷新。
  const subscribeBookmarkPreferences = useCallback<DataContextValue['subscribeBookmarkPreferences']>(
    (next, onError) => observeBookmarkPreferences(db, { next, error: onError }),
    [],
  );
  const refreshData = useCallback(async () => {
    await loadFolders();
    setSettings(await readSettings(db));
    await loadShortcuts();
  }, [loadFolders, setSettings, loadShortcuts]);
  const value = useMemo<DataContextValue>(() => ({
    status, error, folders, shortcuts, settings, loadFolderShortcuts,
    readMediaAsset,
    moveHomeItem: async (placement) => { await moveHomeItem(db, placement); await refreshData(); },
    saveWidget: async (widget) => { await saveWidget(db, widget); await refreshData(); },
    updateWidgetHeight: async (id, height) => { await changeWidgetHeight(db, id, height); await refreshData(); },
    deleteWidget: async (id) => { await deleteWidget(db, id); await refreshData(); },
    isDark: isDarkActive(settings.appearance.theme, systemPrefersDark),
    subscribeBookmarkPreferences,
    ...reportedCommands,
  }), [status, error, folders, shortcuts, settings, loadFolderShortcuts, readMediaAsset, systemPrefersDark,
    subscribeBookmarkPreferences, reportedCommands, refreshData]);
  return <DataContext value={value}><WebDavSyncProvider db={db} refreshData={refreshData}>
    <S3SyncProvider db={db} refreshData={refreshData}>{children}</S3SyncProvider>
  </WebDavSyncProvider></DataContext>;
}