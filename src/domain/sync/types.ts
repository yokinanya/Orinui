import type { AppearanceSettings } from '@/domain/appearance';
import type { LayoutConfig } from '@/domain/layout';
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
export const CURRENT_SYNC_SCHEMA_VERSION = 11 as const;
export const SYNC_SCHEMA_VERSION = CURRENT_SYNC_SCHEMA_VERSION;
export type SupportedSyncSchemaVersion = typeof LEGACY_SYNC_SCHEMA_VERSION | typeof LEGACY_STYLE_SYNC_SCHEMA_VERSION
  | typeof LEGACY_LAYOUT_SYNC_SCHEMA_VERSION | typeof LEGACY_GROUP_SYNC_SCHEMA_VERSION
  | typeof LEGACY_FOLDER_SYNC_SCHEMA_VERSION | typeof PREVIOUS_SYNC_SCHEMA_VERSION
  | typeof LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION | typeof CURRENT_SYNC_SCHEMA_VERSION;

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
}

export interface SyncFolder {
  readonly id: string;
  readonly name: SyncRegister<string>;
  readonly position: SyncRegister<number>;
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

export interface SyncSettings {
  readonly appearance: SyncRegister<AppearanceSettings>;
  readonly defaultEngineId: SyncRegister<string>;
  readonly layout: SyncRegister<LayoutConfig>;
  readonly clock: SyncRegister<AppSettings['clock']>;
  readonly searchPreferences: SyncRegister<Pick<AppSettings['search'], 'width' | 'autoFocus' | 'openTarget'>>;
  readonly searchCustomization: SyncRegister<SearchCustomization>;
  readonly shortcutPreferences: SyncRegister<AppSettings['shortcuts']>;
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
