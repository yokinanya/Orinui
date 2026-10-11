import { useMemo, type ReactNode } from 'react';
import { isDarkActive } from '@/app/apply-appearance';
import { createDataCommands, imageReader } from '@/app/data-commands';
import { DataContext, type DataContextValue } from '@/app/data-context';
import { useSystemPrefersDark } from '@/app/theme';
import { useDataState } from '@/app/use-data-state';
import { db } from '@/storage/db';

/** 数据桥把存储实例注入状态加载与操作模块，界面只访问 useData。 */
export function DataProvider({ children }: { readonly children: ReactNode }) {
  const state = useDataState(db);
  const systemPrefersDark = useSystemPrefersDark();
  const readImageAsset = useMemo(() => imageReader(db), []);
  const { status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId,
    loadGroups, loadShortcuts, setSettings } = state;
  const value = useMemo<DataContextValue>(() => ({
    status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId, readImageAsset,
    isDark: isDarkActive(settings.appearance.theme, systemPrefersDark),
    ...createDataCommands({ db, activeGroupId, loadGroups, loadShortcuts, setActiveGroupId, setSettings }),
  }), [status, error, groups, shortcuts, loadedShortcutsGroupId, settings, activeGroupId, setActiveGroupId,
    readImageAsset, systemPrefersDark, loadGroups, loadShortcuts, setSettings]);
  return <DataContext value={value}>{children}</DataContext>;
}
