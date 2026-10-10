import Dexie, { type EntityTable } from 'dexie';

import { createDefaultAppearance } from '@/domain/appearance';
import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { ImageAsset } from '@/domain/asset';

/** 设置只保存一行，id 固定；结构随版本升级迁移。 */
export type SettingsRow = AppSettings & { id: 'app' };

export const SETTINGS_ID = 'app' as const;

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

  constructor(name: string) {
    super(name);

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
  }
}

/** 测试可为每个用例创建独立数据库，避免相互干扰。 */
export function createDatabase(name: string): OrinuiDatabase {
  return new OrinuiDatabase(name);
}

export const db = createDatabase('orinui');

export type Database = OrinuiDatabase;
