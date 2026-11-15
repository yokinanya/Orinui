import type { Transaction } from 'dexie';
import { createDefaultSearchCustomization } from '@/domain/search-customization';
import { upgradeSlotOrder } from '@/domain/layout';
import { validateSettings } from '@/domain/settings';
import type { SettingsRow } from '@/storage/db';
import type { SyncEntityRecordRow, SyncStateRow } from '@/storage/sync/types';

interface LegacySettingsSyncRecord extends Omit<Extract<SyncEntityRecordRow, { kind: 'settings' }>, 'value'> {
  readonly value: Omit<Extract<SyncEntityRecordRow, { kind: 'settings' }>['value'], 'searchCustomization'>;
}

/** 旧设置行可能仍缺 `bookmarks` 区域；校验前追加到末尾，既有相对顺序不变。 */
function withCurrentLayout(settings: SettingsRow): SettingsRow {
  return { ...settings, layout: { ...settings.layout, order: upgradeSlotOrder(settings.layout.order) } };
}

export async function migrateSearchCustomization(transaction: Transaction): Promise<void> {
  const stateTable = transaction.table('sync_state');
  const settingsTable = transaction.table('settings');
  const recordsTable = transaction.table('sync_records');
  const state = await stateTable.get('app') as SyncStateRow | undefined;
  const settings = await settingsTable.get('app') as SettingsRow | undefined;
  const record = await recordsTable.get('settings:app') as LegacySettingsSyncRecord | undefined;
  if (record && !state) throw new Error('同步设置记录缺少设备身份，数据库升级已回滚');
  if (state && settings) await stateTable.put({ ...state, suspended: true });
  if (settings) await settingsTable.put({ id: 'app', ...validateSettings({ ...withCurrentLayout(settings),
    search: { ...settings.search, customization: createDefaultSearchCustomization() } }) });
  if (record) {
    const migrated = { ...record, value: { ...record.value, searchCustomization: {
      value: createDefaultSearchCustomization(), clock: 0, deviceId: state!.deviceId,
    } } };
    await recordsTable.put(migrated);
  }
  if (state && settings) await stateTable.put(state);
}
