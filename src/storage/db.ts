import Dexie, { type EntityTable } from 'dexie';

import type { Folder } from '@/domain/folder';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { MediaAsset } from '@/domain/asset';
import type { SyncRecordRow, SyncStateRow, SyncKeyRow } from '@/storage/sync/types';
import { createSyncCaptureMiddleware } from '@/storage/sync/middleware';
import { migrateSearchCustomization } from '@/storage/search-customization-migration';
import { migrateSearchEngineOverrides } from '@/storage/search-engine-override-migration';
import { migrateHome } from '@/storage/home-migration';
import { migrateFolderTree } from '@/storage/folder-tree-migration';

/** 设置只保存一行，id 固定；结构随版本升级迁移。 */
export type SettingsRow = AppSettings & { id: 'app' };

export const SETTINGS_ID = 'app' as const;

const LEGACY_SCHEMA_STORES_WITH_SYNC = {
  groups: 'id, order, isDefault',
  shortcuts: 'id, groupId, order',
  settings: 'id',
  assets: 'id, kind',
  sync_state: 'id',
  sync_records: 'id, kind, entityId',
  sync_keys: 'id',
};

const SCHEMA_STORES_WITH_SYNC = {
  folders: 'id, parentId, order',
  shortcuts: 'id, folderId, order',
  settings: 'id',
  assets: 'id, kind',
  sync_state: 'id',
  sync_records: 'id, kind, entityId',
  sync_keys: 'id',
};

function registerSchemaVersions(database: OrinuiDatabase): void {
  database.version(1).stores({ groups: 'id, order, isDefault', shortcuts: 'id, groupId, order', settings: 'id' });
  database.version(2).stores({ groups: 'id, order, isDefault', shortcuts: 'id, groupId, order', settings: 'id', assets: 'id, kind' });
  for (let version = 3; version <= 10; version += 1) database.version(version).stores(LEGACY_SCHEMA_STORES_WITH_SYNC);
  database.version(11).stores({ ...SCHEMA_STORES_WITH_SYNC, groups: null, folders: 'id, order' }).upgrade(() => {
    throw new Error('旧分组安装不兼容当前文件夹版本。请先使用旧版本导出备份并保留，再明确确认后卸载、重新安装扩展；旧备份不能直接导入当前版本。本机数据与同步密钥未被清除，远端数据未被修改。');
  });
  database.version(12).stores({ ...SCHEMA_STORES_WITH_SYNC, folders: 'id, order' }).upgrade(migrateSearchCustomization);
  database.version(13).stores({ ...SCHEMA_STORES_WITH_SYNC, folders: 'id, order' }).upgrade(migrateSearchEngineOverrides);
  database.version(14).stores({ ...SCHEMA_STORES_WITH_SYNC, folders: 'id, order' }).upgrade(migrateHome);
  database.version(15).stores(SCHEMA_STORES_WITH_SYNC).upgrade(migrateFolderTree);
}


export class OrinuiDatabase extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  shortcuts!: EntityTable<Shortcut, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;
  assets!: EntityTable<MediaAsset, 'id'>;
  sync_state!: EntityTable<SyncStateRow, 'id'>;
  sync_records!: EntityTable<SyncRecordRow, 'id'>;
  sync_keys!: EntityTable<SyncKeyRow, 'id'>;
  readonly now: () => number;

  constructor(name: string, options: { readonly now?: () => number } = {}) {
    super(name);
    this.now = options.now ?? Date.now;
    this.use(createSyncCaptureMiddleware(this.now));
    registerSchemaVersions(this);
  }
}

export function createDatabase(name: string, options?: { readonly now?: () => number }): OrinuiDatabase {
  return new OrinuiDatabase(name, options);
}

export const db = createDatabase('orinui');
export type Database = OrinuiDatabase;
