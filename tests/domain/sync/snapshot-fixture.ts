import { createDefaultSettings } from '@/domain/settings';
import { createDefaultAppearance } from '@/domain/appearance';
import { DEFAULT_LAYOUT, splitLayout } from '@/domain/layout';
import { SYNC_SCHEMA_VERSION, type SyncRegister, type SyncSettings, type SyncSnapshot } from '@/domain/sync';

export function register<T>(value: T, clock = 1, deviceId = 'device-a'): SyncRegister<T> {
  return { value, clock, deviceId };
}

/**
 * 把当前分寄存器设置折叠回同步 13 的单块 `layout` 线格式。
 *
 * 历史快照必须按当时的 wire 形状构造，不能拿当前 `SyncSettings` 冒充旧载荷；
 * 书签寄存器在旧协议里不存在，因此一并去掉。
 */
export function legacyWireSettings(settings: SyncSettings): Record<string, unknown> {
  const { layoutOrder, layoutVisibility, layoutPreferences,
    bookmarksEnabled: _enabled, bookmarksMode: _mode, bookmarksShowInSearch: _show, bookmarkRules: _rules,
    ...rest } = settings;
  return { ...rest, layout: {
    value: { ...layoutPreferences.value, order: layoutOrder.value.order, hidden: layoutVisibility.value.hidden },
    clock: Math.max(layoutOrder.clock, layoutVisibility.clock, layoutPreferences.clock),
    deviceId: layoutOrder.deviceId,
  } };
}

export function snapshot(deviceId: string, changes: Partial<SyncSnapshot> = {}): SyncSnapshot {
  const defaults = createDefaultSettings();
  const layout = splitLayout({ ...DEFAULT_LAYOUT });
  return {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: 'vault-1', deviceId, generation: 1,
    folders: [],
    shortcuts: [],
    settings: {
      appearance: register(createDefaultAppearance()), defaultEngineId: register('google'),
      layoutOrder: register({ order: layout.order }), layoutVisibility: register({ hidden: layout.hidden }),
      layoutPreferences: register(layout.preferences), clock: register(defaults.clock),
      searchPreferences: register({ width: defaults.search.width, autoFocus: defaults.search.autoFocus, openTarget: defaults.search.openTarget }),
      searchCustomization: register(defaults.search.customization),
      shortcutPreferences: register(defaults.shortcuts),
      bookmarksEnabled: register(false), bookmarksMode: register('region'), bookmarksShowInSearch: register(true),
      bookmarkRules: {}, customEngines: [],
    },
    assets: [], tombstones: [], ...changes,
  };
}
