import { useCallback, useMemo, type ReactNode } from 'react';
import { isDarkActive } from '@/app/apply-appearance';
import { createDataCommands, imageReader } from '@/app/data-commands';
import { DataContext, type DataContextValue } from '@/app/data-context';
import { useSystemPrefersDark } from '@/app/theme';
import { useDataState } from '@/app/use-data-state';
import { db } from '@/storage/db';
import { readSettings } from '@/storage/settings';
import { WebDavSyncProvider } from '@/app/WebDavSyncProvider';

/** 数据桥把存储实例注入状态加载与操作模块，界面只访问 useData。 */
export function DataProvider({ children }: { readonly children: ReactNode }) {
  const state = useDataState(db);
  const systemPrefersDark = useSystemPrefersDark();
  const readMediaAsset = useMemo(() => imageReader(db), []);
  const { status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId,
    loadGroups, loadShortcuts, setSettings } = state;
  const refreshData = useCallback(async () => {
    const nextGroups = await loadGroups();
    setSettings(await readSettings(db));
    const selected = nextGroups.some((group) => group.id === activeGroupId) ? activeGroupId
      : nextGroups.find((group) => group.isDefault)?.id;
    if (!selected) throw new Error('同步后的本机数据缺少默认分组');
    if (selected !== activeGroupId) setActiveGroupId(selected);
    await loadShortcuts(selected);
  }, [loadGroups, setSettings, activeGroupId, setActiveGroupId, loadShortcuts]);
  const value = useMemo<DataContextValue>(() => ({
    status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId, readMediaAsset,
    isDark: isDarkActive(settings.appearance.theme, systemPrefersDark),
    ...createDataCommands({ db, activeGroupId, loadGroups, loadShortcuts, setActiveGroupId, setSettings }),
  }), [status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId,
    readMediaAsset, systemPrefersDark, loadGroups, loadShortcuts, setSettings]);
  return <DataContext value={value}><WebDavSyncProvider db={db} refreshData={refreshData}>{children}</WebDavSyncProvider></DataContext>;
}
