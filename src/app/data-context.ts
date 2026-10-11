import { createContext, use } from 'react';

import type { AppearanceSettings } from '@/domain/appearance';
import type { Group, GroupColorRole } from '@/domain/group';
import type { LayoutConfig } from '@/domain/layout';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { NewShortcut, RemovedShortcut, ShortcutPatch } from '@/storage/shortcuts';
import type { ImageAsset } from '@/domain/asset';
import type { NewImageAsset } from '@/storage/assets';
import type { SearchEngine } from '@/domain/search-engines';
import type { ClockFormat } from '@/domain/settings';
import type { RestorableBackup } from '@/platform/backup-file';

export type DataStatus = 'loading' | 'ready' | 'error';

export interface DataContextValue {
  status: DataStatus;
  /** 初始化失败的原因；仅在 status 为 error 时有值。 */
  error: string | null;
  groups: Group[];
  /** 当前分组的网站，按组内顺序排列。 */
  shortcuts: Shortcut[];
  /** 当前网站数组所属分组，防止异步切组显示旧组内容。 */
  loadedShortcutsGroupId: string | null;
  settings: AppSettings;
  activeGroupId: string | null;
  /** 当前生效的深浅模式，已合并“跟随系统” */
  isDark: boolean;
  setActiveGroupId: (id: string) => void;

  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  updateLayout: (layout: LayoutConfig) => Promise<void>;
  updateClockFormat: (format: ClockFormat) => Promise<void>;
  setDefaultEngine: (id: string) => Promise<void>;
  createSearchEngine: (input: Pick<SearchEngine, 'name' | 'template'>) => Promise<void>;
  updateSearchEngine: (id: string, input: Pick<SearchEngine, 'name' | 'template'>) => Promise<void>;
  deleteSearchEngine: (id: string) => Promise<void>;
  updateGroupColor: (id: string, colorRole: GroupColorRole | null) => Promise<void>;
  exportBackup: () => Promise<Blob>;
  restoreBackup: (backup: RestorableBackup) => Promise<void>;
  resetLocalData: () => Promise<void>;
  setPhotoBackground: (image: NewImageAsset) => Promise<void>;
  clearImageSourceUrl: (assetId: string) => Promise<void>;
  readImageAsset: (id: string) => Promise<ImageAsset>;

  createShortcut: (input: NewShortcut) => Promise<void>;
  updateShortcut: (id: string, patch: ShortcutPatch) => Promise<void>;
  deleteShortcut: (id: string) => Promise<RemovedShortcut>;
  restoreShortcut: (shortcut: RemovedShortcut) => Promise<void>;
  moveShortcut: (id: string, direction: 'up' | 'down') => Promise<void>;
  /** 拖动排序：移动到组内指定下标 */
  reorderShortcut: (id: string, index: number) => Promise<void>;
  moveShortcutToGroup: (id: string, groupId: string) => Promise<void>;

  createGroup: (name: string) => Promise<void>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveGroup: (id: string, direction: 'up' | 'down') => Promise<void>;
  /** 拖动排序：移动到全局指定下标 */
  reorderGroup: (id: string, index: number) => Promise<void>;
  countShortcutsInGroup: (groupId: string) => Promise<number>;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = use(DataContext);
  if (!value) {
    throw new Error('useData 必须在 DataProvider 内使用');
  }
  return value;
}
