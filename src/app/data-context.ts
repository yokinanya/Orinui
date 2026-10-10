import { createContext, use } from 'react';

import type { AppearanceSettings } from '@/domain/appearance';
import type { Group } from '@/domain/group';
import type { LayoutConfig } from '@/domain/layout';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { NewShortcut, ShortcutPatch } from '@/storage/shortcuts';

export type DataStatus = 'loading' | 'ready' | 'error';

export interface DataContextValue {
  status: DataStatus;
  /** 初始化失败的原因；仅在 status 为 error 时有值。 */
  error: string | null;
  groups: Group[];
  /** 当前分组的网站，按组内顺序排列。 */
  shortcuts: Shortcut[];
  settings: AppSettings;
  activeGroupId: string | null;
  /** 当前生效的深浅模式，已合并“跟随系统” */
  isDark: boolean;
  setActiveGroupId: (id: string) => void;

  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  updateLayout: (layout: LayoutConfig) => Promise<void>;

  createShortcut: (input: NewShortcut) => Promise<void>;
  updateShortcut: (id: string, patch: ShortcutPatch) => Promise<void>;
  deleteShortcut: (id: string) => Promise<Shortcut>;
  restoreShortcut: (shortcut: Shortcut) => Promise<void>;
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
