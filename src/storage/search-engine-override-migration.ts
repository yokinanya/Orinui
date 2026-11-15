import type { Transaction } from 'dexie';
import { validateSearchCustomization, upgradeLegacySearchCustomization } from '@/domain/search-customization';
import { upgradeSlotOrder } from '@/domain/layout';
import { validateSettings } from '@/domain/settings';
import type { SearchCustomization } from '@/domain/search-customization';
import type { SettingsRow } from '@/storage/db';
import type { SyncEntityRecordRow, SyncStateRow } from '@/storage/sync/types';

type LegacyCustomization = Omit<SearchCustomization, 'engineOverrides'>;
type CustomizationRegister = Extract<SyncEntityRecordRow, { kind: 'settings' }>['value']['searchCustomization'];
type LegacyRegister = Omit<CustomizationRegister, 'value'> & { readonly value: LegacyCustomization };
type LegacySettingsRecord = Omit<Extract<SyncEntityRecordRow, { kind: 'settings' }>, 'value'> & {
  readonly value: Omit<Extract<SyncEntityRecordRow, { kind: 'settings' }>['value'], 'searchCustomization'> & {
    readonly searchCustomization: LegacyRegister | CustomizationRegister;
  };
};

function migrateCustomization(value: unknown): SearchCustomization {
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'engineOverrides')) {
    return validateSearchCustomization(value);
  }
  return upgradeLegacySearchCustomization(value);
}

export async function migrateSearchEngineOverrides(transaction: Transaction): Promise<void> {
  const stateTable = transaction.table('sync_state');
  const settingsTable = transaction.table('settings');
  const recordsTable = transaction.table('sync_records');
  const state = await stateTable.get('app') as SyncStateRow | undefined;
  const settings = await settingsTable.get('app') as SettingsRow | undefined;
  const record = await recordsTable.get('settings:app') as LegacySettingsRecord | undefined;
  if (record && !state) throw new Error('同步设置记录缺少设备身份，数据库升级已回滚');
  if (state && settings) await stateTable.put({ ...state, suspended: true });
  if (settings) {
    const customization = migrateCustomization(settings.search.customization);
    const migrated = validateSettings({ ...settings, layout: { ...settings.layout,
      order: upgradeSlotOrder(settings.layout.order) }, search: { ...settings.search, customization } });
    await settingsTable.put({ id: 'app', ...migrated });
  }
  if (record) {
    const customization = migrateCustomization(record.value.searchCustomization.value);
    await recordsTable.put({ ...record, value: { ...record.value,
      searchCustomization: { ...record.value.searchCustomization, value: customization } } });
  }
  if (state && settings) await stateTable.put(state);
}
