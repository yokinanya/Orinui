import type { AppearanceSettings } from '@/domain/appearance';
import type { BookmarkHiddenRule } from '@/domain/bookmark-preferences';
import type { LayoutConfig, LayoutPreferences, SlotId } from '@/domain/layout';
import type { AppSettings } from '@/domain/settings';
import type { SearchEngine } from '@/domain/search-engines';
import type { SearchCustomization } from '@/domain/search-customization';
import type { ShortcutIcon } from '@/domain/shortcut';

export const LEGACY_SYNC_SCHEMA_VERSION = 4 as const;
export const LEGACY_STYLE_SYNC_SCHEMA_VERSION = 5 as const;
export const LEGACY_LAYOUT_SYNC_SCHEMA_VERSION = 6 as const;
export const LEGACY_GROUP_SYNC_SCHEMA_VERSION = 7 as const;
export const LEGACY_FOLDER_SYNC_SCHEMA_VERSION = 8 as const;
export const LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION = 10 as const;
export const PREVIOUS_SYNC_SCHEMA_VERSION = 9 as const;
export const LEGACY_ENGINE_OVERRIDE_SYNC_SCHEMA_VERSION = 11 as const;
export const LEGACY_HOME_SYNC_SCHEMA_VERSION = 12 as const;
export const LEGACY_FLAT_FOLDER_SYNC_SCHEMA_VERSION = 13 as const;
export const CURRENT_SYNC_SCHEMA_VERSION = 14 as const;
export const SYNC_SCHEMA_VERSION = CURRENT_SYNC_SCHEMA_VERSION;
export type SupportedSyncSchemaVersion = typeof LEGACY_SYNC_SCHEMA_VERSION | typeof LEGACY_STYLE_SYNC_SCHEMA_VERSION
  | typeof LEGACY_LAYOUT_SYNC_SCHEMA_VERSION | typeof LEGACY_GROUP_SYNC_SCHEMA_VERSION
  | typeof LEGACY_FOLDER_SYNC_SCHEMA_VERSION | typeof PREVIOUS_SYNC_SCHEMA_VERSION
  | typeof LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION | typeof LEGACY_ENGINE_OVERRIDE_SYNC_SCHEMA_VERSION
  | typeof LEGACY_HOME_SYNC_SCHEMA_VERSION | typeof LEGACY_FLAT_FOLDER_SYNC_SCHEMA_VERSION
  | typeof CURRENT_SYNC_SCHEMA_VERSION;

export interface SyncRegister<T> {
  readonly value: T;
  readonly clock: number;
  readonly deviceId: string;
}

export type SyncEntityType = 'folder' | 'shortcut' | 'asset' | 'custom-engine';

export interface SyncTombstone {
  readonly entityType: SyncEntityType;
  readonly id: string;
  readonly clock: number;
  readonly deviceId: string;
  /**
   * 仅文件夹墓碑：被删文件夹删除时所在的父层。
   *
   * 后代寄存器的 `parentId` 仍指向已删节点；没有这条元数据就无法在任何设备上重建
   * 「最近存活祖先」，只能退回主页。缺省表示 legacy 墓碑（早于该元数据），解析时保持
   * 缺省；活跃写入端只写 `string`（被删时的父文件夹 ID），因此 wire 上的 `null` 会被
   * 规范化为缺省，不猜测、不改写后代寄存器。非文件夹墓碑不携带该字段。
   */
  readonly parentId?: string;
}

/** 文件夹位置：父引用与同层顺序是同一个原子寄存器，不能分别胜出。 */
export interface SyncFolderPosition {
  readonly parentId: string | null;
  readonly order: number;
}

export interface SyncFolder {
  readonly id: string;
  readonly name: SyncRegister<string>;
  readonly position: SyncRegister<SyncFolderPosition>;
}

export interface SyncShortcut {
  readonly id: string;
  readonly title: SyncRegister<string>;
  readonly url: SyncRegister<string>;
  readonly placement: SyncRegister<{ readonly folderId: string | null; readonly order: number }>;
  readonly icon: SyncRegister<ShortcutIcon>;
}

export interface SyncAsset {
  readonly id: string;
  readonly kind: 'background' | 'icon';
  readonly mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml' | 'video/mp4' | 'video/webm';
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly sourceUrl: SyncRegister<string | null>;
  readonly name: SyncRegister<string | null>;
  readonly motion: { readonly kind: 'video' | 'animation'; readonly duration: number | null } | null;
}

export interface SyncLayoutOrder {
  readonly order: readonly SlotId[];
}

export interface SyncLayoutVisibility {
  readonly hidden: readonly SlotId[];
}

/** 逐条隐藏规则寄存器；`null` 是该规则的删除值（普通 LWW，不做跨版本 delete-wins）。 */
export type SyncBookmarkRules = Readonly<Record<string, SyncRegister<BookmarkHiddenRule | null>>>;

export interface SyncSettings {
  readonly home?: import('@/domain/sync/home').SyncHome;
  readonly appearance: SyncRegister<AppearanceSettings>;
  readonly defaultEngineId: SyncRegister<string>;
  /** 区域顺序与显隐各自独立，编辑其一不会覆盖其他布局偏好。 */
  readonly layoutOrder: SyncRegister<SyncLayoutOrder>;
  readonly layoutVisibility: SyncRegister<SyncLayoutVisibility>;
  readonly layoutPreferences: SyncRegister<LayoutPreferences>;
  readonly clock: SyncRegister<AppSettings['clock']>;
  readonly searchPreferences: SyncRegister<Pick<AppSettings['search'], 'width' | 'autoFocus' | 'openTarget'>>;
  readonly searchCustomization: SyncRegister<SearchCustomization>;
  readonly shortcutPreferences: SyncRegister<AppSettings['shortcuts']>;
  readonly bookmarksEnabled: SyncRegister<boolean>;
  readonly bookmarksMode: SyncRegister<AppSettings['bookmarks']['mode']>;
  readonly bookmarksShowInSearch: SyncRegister<boolean>;
  readonly bookmarkRules: SyncBookmarkRules;
  readonly customEngines: readonly SyncRegister<SearchEngine>[];
}

export interface SyncSnapshot {
  readonly schemaVersion: typeof SYNC_SCHEMA_VERSION;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly folders: readonly SyncFolder[];
  readonly shortcuts: readonly SyncShortcut[];
  readonly settings: SyncSettings;
  readonly assets: readonly SyncAsset[];
  readonly tombstones: readonly SyncTombstone[];
}

/** 旧布局寄存器内容，仅升级路径使用。 */
export type LegacyLayoutValue = LayoutConfig;
