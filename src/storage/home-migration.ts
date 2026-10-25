import type { Transaction } from 'dexie';
import { EMPTY_HOME, reconcileHome } from '@/domain/home';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { validateSettings } from '@/domain/settings';
import { seedHome } from '@/domain/sync/home';
import type { SettingsRow } from '@/storage/db';
import type { SyncStateRow } from '@/storage/sync/types';

export async function migrateHome(transaction: Transaction): Promise<void> {
  const stateTable = transaction.table('sync_state');
  const settingsTable = transaction.table('settings');
  const recordsTable = transaction.table('sync_records');
  const state = await stateTable.get('app') as SyncStateRow | undefined;
  const settings = await settingsTable.get('app') as SettingsRow | undefined;
  if (state) await stateTable.put({ ...state, suspended: true });
  if (settings) {
    validateSettings(settings);
    const home = reconcileHome({ home: EMPTY_HOME, folders: await transaction.table('folders').toArray(),
      shortcuts: await transaction.table('shortcuts').toArray() });
    const layout = { ...settings.layout, style: DEFAULT_LAYOUT.style, order: [...DEFAULT_LAYOUT.order],
      clockPosition: DEFAULT_LAYOUT.clockPosition, columns: DEFAULT_LAYOUT.columns };
    const migrated = validateSettings({ ...settings, home, layout, shortcuts: { ...settings.shortcuts, showNames: true } });
    await settingsTable.put({ ...migrated, id: 'app' });
  }
  // Existing field stamps and encryption keys remain intact; new home fields are seeded on export.
  const record = await recordsTable.get('settings:app');
  if (record && !state) throw new Error('同步设置记录缺少设备身份，数据库升级已回滚');
  const migratedSettings = await settingsTable.get('app') as SettingsRow | undefined;
  if (record && state) await recordsTable.put({ ...record, value: { ...record.value,
    home: seedHome(migratedSettings?.home ?? EMPTY_HOME, state.deviceId),
    layout: { ...record.value.layout, value: { ...record.value.layout.value, style: DEFAULT_LAYOUT.style,
      order: [...DEFAULT_LAYOUT.order], clockPosition: DEFAULT_LAYOUT.clockPosition, columns: DEFAULT_LAYOUT.columns } },
    shortcutPreferences: { ...record.value.shortcutPreferences, value: { ...record.value.shortcutPreferences.value, showNames: true } } } });
  if (state) await stateTable.put(state);
}
