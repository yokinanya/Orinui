import type { AppearanceSettings } from '@/domain/appearance';
import type { GroupColorRole } from '@/domain/group';
import type { LayoutConfig } from '@/domain/layout';
import type { AppSettings } from '@/domain/settings';
import type { SearchEngine } from '@/domain/search-engines';
import type { ShortcutIcon } from '@/domain/shortcut';

export const SYNC_SCHEMA_VERSION = 2 as const;

export interface SyncRegister<T> {
  readonly value: T;
  readonly clock: number;
  readonly deviceId: string;
}

export type SyncEntityType = 'group' | 'shortcut' | 'asset' | 'custom-engine';

export interface SyncTombstone {
  readonly entityType: SyncEntityType;
  readonly id: string;
  readonly clock: number;
  readonly deviceId: string;
}

export interface SyncGroup {
  readonly id: string;
  readonly name: SyncRegister<string>;
  readonly colorRole: SyncRegister<GroupColorRole | null>;
  readonly position: SyncRegister<number>;
}

export interface SyncShortcut {
  readonly id: string;
  readonly title: SyncRegister<string>;
  readonly url: SyncRegister<string>;
  readonly placement: SyncRegister<{ readonly groupId: string; readonly order: number }>;
  readonly icon: SyncRegister<ShortcutIcon>;
}

export interface SyncAsset {
  readonly id: string;
  readonly kind: 'background' | 'icon';
  readonly mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly sourceUrl: SyncRegister<string | null>;
}

export interface SyncSettings {
  readonly appearance: SyncRegister<AppearanceSettings>;
  readonly defaultEngineId: SyncRegister<string>;
  readonly layout: SyncRegister<LayoutConfig>;
  readonly clock: SyncRegister<AppSettings['clock']>;
  readonly searchPreferences: SyncRegister<Pick<AppSettings['search'], 'width' | 'autoFocus' | 'openTarget'>>;
  readonly shortcutPreferences: SyncRegister<AppSettings['shortcuts']>;
  readonly customEngines: readonly SyncRegister<SearchEngine>[];
}

export interface SyncSnapshotV1 {
  readonly schemaVersion: typeof SYNC_SCHEMA_VERSION;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly defaultGroupId: SyncRegister<string>;
  readonly groups: readonly SyncGroup[];
  readonly shortcuts: readonly SyncShortcut[];
  readonly settings: SyncSettings;
  readonly assets: readonly SyncAsset[];
  readonly tombstones: readonly SyncTombstone[];
}
