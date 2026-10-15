import Dexie, { type EntityTable, type Transaction } from 'dexie';

import { createDefaultAppearance } from '@/domain/appearance';
import { createDefaultSettings, validateSettings } from '@/domain/settings';
import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { MediaAsset } from '@/domain/asset';
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

async function migratePersonalization(transaction: Transaction): Promise<void> {
  const defaults = createDefaultSettings();
  const syncState = transaction.table<SyncStateRow, string>('sync_state');
  const previousState = await syncState.get('app');
  // 迁移同时改写设置与对应寄存器，不能让捕获中间状态生成新的同步版本。
  if (previousState) await syncState.update('app', { suspended: true });
  await transaction.table<Record<string, unknown>, string>('settings').toCollection().modify((row) => {
    const settings = validateSettings({
      ...defaults,
      ...row,
      search: { ...defaults.search, ...asObject(row['search'], '搜索设置') },
      shortcuts: defaults.shortcuts,
      layout: { ...defaults.layout, ...asObject(row['layout'], '布局设置') },
      clock: { ...defaults.clock, ...asObject(row['clock'], '时钟设置') },
    });
    Object.assign(row, settings);
  });

  await transaction.table<SyncRecordRow, string>('sync_records').where('kind').equals('settings').modify((record) => {
    if (record.kind !== 'settings') return;
    const previous = record.value;
    Object.assign(record, { value: {
      ...previous,
      layout: { ...previous.layout, value: {
        ...defaults.layout, ...asObject(previous.layout.value, '同步布局设置') } },
      clock: { ...previous.clock, value: {
        ...defaults.clock, ...asObject(previous.clock.value, '同步时钟设置') } },
      searchPreferences: { value: {
        width: defaults.search.width, autoFocus: defaults.search.autoFocus,
        openTarget: defaults.search.openTarget,
      }, clock: 0, deviceId: previous.clock.deviceId },
      shortcutPreferences: { value: defaults.shortcuts, clock: 0, deviceId: previous.clock.deviceId },
    } });
  });
  if (previousState) await syncState.update('app', { suspended: previousState.suspended });
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}格式不正确，无法迁移`);
  }
  return value as Record<string, unknown>;
}

const SCHEMA_STORES_WITH_SYNC = {
  groups: 'id, order, isDefault',
  shortcuts: 'id, groupId, order',
  settings: 'id',
  assets: 'id, kind',
  sync_state: 'id',
  sync_records: 'id, kind, entityId',
  sync_keys: 'id',
};

function registerSchemaVersions(database: OrinuiDatabase): void {
  database.version(1).stores({
    groups: 'id, order, isDefault',
    shortcuts: 'id, groupId, order',
    settings: 'id',
  });

  database.version(2).stores({
    groups: 'id, order, isDefault',
    shortcuts: 'id, groupId, order',
    settings: 'id',
    assets: 'id, kind',
  }).upgrade(async (transaction) => {
    const settings = transaction.table<Record<string, unknown>, string>('settings');
    await settings.toCollection().modify((row) => {
      const existing = row['appearance'];
      row['appearance'] = {
        ...createDefaultAppearance(),
        ...(typeof existing === 'object' && existing !== null ? existing : {}),
      };
    });
  });

  database.version(3).stores({ ...SCHEMA_STORES_WITH_SYNC });
  database.version(4).stores({ ...SCHEMA_STORES_WITH_SYNC }).upgrade(migrateIconOccupancy);
  database.version(5).stores({ ...SCHEMA_STORES_WITH_SYNC }).upgrade(migratePersonalization);
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

/** 测试可为每个用例创建独立数据库，避免相互干扰。 */
export function createDatabase(name: string, options?: { readonly now?: () => number }): OrinuiDatabase {
  return new OrinuiDatabase(name, options);
}

export const db = createDatabase('orinui');

export type Database = OrinuiDatabase;
