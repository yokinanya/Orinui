import { createContext, use } from 'react';

import type { AppearanceSettings } from '@/domain/appearance';
import type { Folder } from '@/domain/folder';
import type { LayoutConfig } from '@/domain/layout';
import type { AppSettings, SearchPreferences, ShortcutPreferences } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { NewShortcut, RemovedShortcut, ShortcutPatch } from '@/storage/shortcuts';
import type { MediaAsset } from '@/domain/asset';
import type { NewMediaAsset } from '@/storage/assets';
import type { SearchEngine } from '@/domain/search-engines';
import type { ClockFormat } from '@/domain/settings';
import type { RestorableBackup } from '@/platform/backup-file';
import type { SearchCustomizationPatch, SearchToolGroup } from '@/domain/search-customization';

export type DataStatus = 'loading' | 'ready' | 'error';

export interface DataContextValue {
  status: DataStatus;
  /** 初始化失败的原因；仅在 status 为 error 时有值。 */
  error: string | null;
  folders: Folder[];
  /** 主页网格上的网站（不含文件夹内的网站），按网格顺序排列。 */
  shortcuts: Shortcut[];
  settings: AppSettings;
  /** 当前生效的深浅模式，已合并“跟随系统” */
  isDark: boolean;
  /** 打开文件夹弹层时，按需读取其中的网站。 */
  loadFolderShortcuts: (folderId: string) => Promise<Shortcut[]>;

  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  updateLayout: (patch: Partial<LayoutConfig>) => Promise<void>;
  resetLayout: () => Promise<void>;
  updateClockFormat: (format: ClockFormat) => Promise<void>;
  updateClockSettings: (patch: Partial<AppSettings['clock']>) => Promise<void>;
  updateSearchPreferences: (patch: Partial<SearchPreferences>) => Promise<void>;
  updateSearchCustomization: (patch: SearchCustomizationPatch) => Promise<void>;
  setSearchToolEnabled: (group: SearchToolGroup, enabled: boolean) => Promise<void>;
  setSearchEngineKeyword: (engineId: string, keyword: string) => Promise<void>;
  updateShortcutPreferences: (patch: Partial<ShortcutPreferences>) => Promise<void>;
  setDefaultEngine: (id: string) => Promise<void>;
  createSearchEngine: (input: Pick<SearchEngine, 'name' | 'template'>) => Promise<void>;
  updateSearchEngine: (id: string, input: Pick<SearchEngine, 'name' | 'template'>) => Promise<void>;
  deleteSearchEngine: (id: string) => Promise<void>;
  exportBackup: () => Promise<Blob>;
  restoreBackup: (backup: RestorableBackup) => Promise<void>;
  resetLocalData: () => Promise<void>;
  setPhotoBackground: (image: NewMediaAsset) => Promise<void>;
  setMotionBackground: (media: NewMediaAsset) => Promise<void>;
  activateBackgroundAsset: (id: string) => Promise<void>;
  deleteBackgroundAsset: (id: string) => Promise<void>;
  listBackgroundAssets: () => Promise<MediaAsset[]>;
  renameBackgroundAsset: (id: string, name: string) => Promise<void>;
  reorderBackgroundAsset: (id: string, targetId: string) => Promise<void>;
  moveBackgroundAsset: (id: string, direction: -1 | 1) => Promise<boolean>;
  clearImageSourceUrl: (assetId: string) => Promise<void>;
  readMediaAsset: (id: string) => Promise<MediaAsset>;

  createShortcut: (input: NewShortcut) => Promise<void>;
  updateShortcut: (id: string, patch: ShortcutPatch) => Promise<void>;
  deleteShortcut: (id: string) => Promise<RemovedShortcut>;
  restoreShortcut: (shortcut: RemovedShortcut) => Promise<void>;
  moveShortcut: (id: string, direction: 'up' | 'down') => Promise<void>;
  /** 拖动排序：移动到同一容器内的指定下标 */
  reorderShortcut: (id: string, index: number) => Promise<void>;
  /** 移动到某个文件夹；folderId 为 null 表示移回主页网格 */
  moveShortcutToFolder: (id: string, folderId: string | null) => Promise<void>;

  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, direction: 'up' | 'down') => Promise<void>;
  /** 拖动排序：移动到全局指定下标 */
  reorderFolder: (id: string, index: number) => Promise<void>;
  countShortcutsInFolder: (folderId: string) => Promise<number>;
  listAllShortcuts: () => Promise<Shortcut[]>;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = use(DataContext);
  if (!value) {
    throw new Error('useData 必须在 DataProvider 内使用');
  }
  return value;
}
