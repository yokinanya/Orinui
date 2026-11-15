import type { Transaction } from 'dexie';
import { EMPTY_HOME, reconcileHome } from '@/domain/home';
import { DEFAULT_LAYOUT, upgradeSlotOrder } from '@/domain/layout';
import { validateSettings } from '@/domain/settings';
import { seedHome } from '@/domain/sync/home';
import type { SettingsRow } from '@/storage/db';
import type { SyncStateRow } from '@/storage/sync/types';

/**
 * 布局顺序升级：旧数据缺 `bookmarks` 时追加到末尾。
 *
 * 历史迁移在同一个事务里前后都调用它，保证任何旧版本的设置都能通过当前严格校验；
 * 既有相对顺序与隐藏项不变。
 */
function upgradedLayout<T extends { readonly order?: unknown }>(layout: T): T {
  return { ...layout, order: upgradeSlotOrder(layout.order) };
}

export async function migrateHome(transaction: Transaction): Promise<void> {
  const stateTable = transaction.table('sync_state');
  const settingsTable = transaction.table('settings');
  const recordsTable = transaction.table('sync_records');
  const state = await stateTable.get('app') as SyncStateRow | undefined;
  const settings = await settingsTable.get('app') as SettingsRow | undefined;
  if (state) await stateTable.put({ ...state, suspended: true });
  if (settings) {
    validateSettings({ ...settings, layout: upgradedLayout(settings.layout) });
    const home = reconcileHome({ home: EMPTY_HOME, folders: await transaction.table('folders').toArray(),
      shortcuts: await transaction.table('shortcuts').toArray() });
    // 退役的布局模板回到居中样式；区域顺序只在末尾追加缺失的 `bookmarks`，不重置用户顺序。
    const layout = { ...upgradedLayout(settings.layout), style: DEFAULT_LAYOUT.style,
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
    layout: { ...record.value.layout, value: { ...upgradedLayout(record.value.layout.value), style: DEFAULT_LAYOUT.style,
      clockPosition: DEFAULT_LAYOUT.clockPosition, columns: DEFAULT_LAYOUT.columns } },
    shortcutPreferences: { ...record.value.shortcutPreferences, value: { ...record.value.shortcutPreferences.value, showNames: true } } } });
  if (state) await stateTable.put(state);
}
