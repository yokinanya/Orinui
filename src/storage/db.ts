import Dexie, { type EntityTable, type Transaction } from 'dexie';

import { createDefaultAppearance } from '@/domain/appearance';
import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { ImageAsset } from '@/domain/asset';
import { parseShortcutIcon } from '@/domain/shortcut-icon';
import type { SyncRecordRow, SyncStateRow, SyncKeyRow } from '@/storage/sync/types';
import { createSyncCaptureMiddleware } from '@/storage/sync/middleware';

/** 设置只保存一行，id 固定；结构随版本升级迁移。 */
export type SettingsRow = AppSettings & { id: 'app' };

export const SETTINGS_ID = 'app' as const;

async function migrateIconOccupancy(transaction: Transaction): Promise<void> {
  await transaction.table<Shortcut, string>('shortcuts').toCollection().modify((shortcut) => {
    shortcut.icon = parseShortcutIcon(shortcut.icon);
  });
  await transaction.table<SyncRecordRow, string>('sync_records').where('kind').equals('shortcut').modify((record) => {
    if (record.kind !== 'shortcut') return;
    Object.assign(record.value, { icon: { ...record.value.icon, value: parseShortcutIcon(record.value.icon.value) } });
  });
}

/**
 * 本地数据库。
 *
 * 升级规则：新增 `this.version(n).stores(...)` 时列出完整表结构，
 * 并在 `upgrade` 中把既有数据迁移到新结构。
 */
export class OrinuiDatabase extends Dexie {
  groups!: EntityTable<Group, 'id'>;
  shortcuts!: EntityTable<Shortcut, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;
  assets!: EntityTable<ImageAsset, 'id'>;
  sync_state!: EntityTable<SyncStateRow, 'id'>;
  sync_records!: EntityTable<SyncRecordRow, 'id'>;
  sync_keys!: EntityTable<SyncKeyRow, 'id'>;
  readonly now: () => number;

  constructor(name: string, options: { readonly now?: () => number } = {}) {
    super(name);
    this.now = options.now ?? Date.now;
    this.use(createSyncCaptureMiddleware(this.now));

    this.version(1).stores({
      groups: 'id, order, isDefault',
      shortcuts: 'id, groupId, order',
      settings: 'id',
    });

    // 版本 2：外观设置扩展为「主题 + 背景 + 动态配色」，并新增图片资源表。
    this.version(2)
      .stores({
        groups: 'id, order, isDefault',
        shortcuts: 'id, groupId, order',
        settings: 'id',
        assets: 'id, kind',
      })
      .upgrade(async (transaction) => {
        const settings = transaction.table<Record<string, unknown>, string>('settings');
        await settings.toCollection().modify((row) => {
          const existing = row['appearance'];
          row['appearance'] = {
            ...createDefaultAppearance(),
            ...(typeof existing === 'object' && existing !== null ? existing : {}),
          };
        });
      });

    this.version(3).stores({
      groups: 'id, order, isDefault',
      shortcuts: 'id, groupId, order',
      settings: 'id',
      assets: 'id, kind',
      sync_state: 'id',
      sync_records: 'id, kind, entityId',
      sync_keys: 'id',
    });

    this.version(4).stores({
      groups: 'id, order, isDefault',
      shortcuts: 'id, groupId, order',
      settings: 'id',
      assets: 'id, kind',
      sync_state: 'id',
      sync_records: 'id, kind, entityId',
      sync_keys: 'id',
    }).upgrade(migrateIconOccupancy);
  }
}

/** 测试可为每个用例创建独立数据库，避免相互干扰。 */
export function createDatabase(name: string, options?: { readonly now?: () => number }): OrinuiDatabase {
  return new OrinuiDatabase(name, options);
}

export const db = createDatabase('orinui');

export type Database = OrinuiDatabase;
