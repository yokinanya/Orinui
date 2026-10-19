import { createDefaultSettings } from '@/domain/settings';
import { createDefaultAppearance } from '@/domain/appearance';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { SYNC_SCHEMA_VERSION, type SyncRegister, type SyncSnapshot } from '@/domain/sync';

export function register<T>(value: T, clock = 1, deviceId = 'device-a'): SyncRegister<T> {
  return { value, clock, deviceId };
}

export function snapshot(deviceId: string, changes: Partial<SyncSnapshot> = {}): SyncSnapshot {
  const defaults = createDefaultSettings();
  return {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: 'vault-1', deviceId, generation: 1,
    folders: [],
    shortcuts: [],
    settings: {
      appearance: register(createDefaultAppearance()), defaultEngineId: register('google'),
      layout: register(DEFAULT_LAYOUT), clock: register(defaults.clock),
      searchPreferences: register({ width: defaults.search.width, autoFocus: defaults.search.autoFocus, openTarget: defaults.search.openTarget }),
      searchCustomization: register(defaults.search.customization),
      shortcutPreferences: register(defaults.shortcuts), customEngines: [],
    },
    assets: [], tombstones: [], ...changes,
  };
}
