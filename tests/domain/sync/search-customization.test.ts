import { expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings';
import { parseSyncSnapshot, materializeSyncSnapshot, mergeSyncSnapshots, SYNC_SCHEMA_VERSION, LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION } from '@/domain/sync';
import { register, snapshot } from './snapshot-fixture';

it('upgrades schema 10 search settings to explicit defaults with a zero register clock', () => {
  const current = snapshot('device-a');
  const { searchCustomization: _ignored, ...legacySettings } = current.settings;
  const parsed = parseSyncSnapshot({ ...current, schemaVersion: LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION,
    settings: legacySettings });
  expect(parsed.settings.searchCustomization).toEqual({
    value: createDefaultSettings().search.customization, clock: 0, deviceId: 'device-a',
  });
  expect(parsed.schemaVersion).toBe(SYNC_SCHEMA_VERSION);
  expect(materializeSyncSnapshot(parsed).settings.search.customization).toEqual(createDefaultSettings().search.customization);
});

it('strictly separates schema 10 and 11 search register shapes', () => {
  const current = snapshot('device-a');
  const legacySettings = { ...current.settings } as Record<string, unknown>;
  delete legacySettings.searchCustomization;
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 10,
    settings: { ...legacySettings, searchCustomization: current.settings.searchCustomization } })).toThrow(/字段不正确/);
  expect(() => parseSyncSnapshot({ ...current, settings: legacySettings })).toThrow(/字段不正确/);
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 9, settings: legacySettings })).toThrow(/不兼容/);
});

it('does not let a schema 10 snapshot overwrite newer customized search settings', () => {
  const local = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    searchCustomization: register({ ...createDefaultSettings().search.customization, placeholder: '查找' }, 4, 'device-a') } });
  const source = snapshot('device-b');
  const { searchCustomization: _ignored, ...legacySettings } = source.settings;
  const legacy = parseSyncSnapshot({ ...source, schemaVersion: LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION, settings: legacySettings });
  const merged = mergeSyncSnapshots({ local, remotes: [legacy] });
  expect(merged.settings.searchCustomization.value.placeholder).toBe('查找');
  expect(merged.settings.searchCustomization.clock).toBe(4);
});

it('keeps search customization in its own register and removes keywords for deleted engines', () => {
  const settings = createDefaultSettings();
  const engine = { id: 'custom-1', name: '文档', template: 'https://example.test/?q={query}', builtIn: false };
  const local = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    customEngines: [register(engine, 2)],
    searchCustomization: register({ ...settings.search.customization, engineKeywords: { 'custom-1': 'docs' } }, 3),
  } });
  const remote = snapshot('device-b', {
    assets: [{ id: 'wallpaper', kind: 'background', mime: 'image/png', width: 1, height: 1, byteLength: 1,
      sha256: 'a'.repeat(64), motion: null, sourceUrl: register(null, 1, 'device-b'),
      name: register('高版本素材名称', 99, 'device-b') }],
    tombstones: [{ entityType: 'custom-engine', id: engine.id, clock: 4, deviceId: 'device-b' }],
  });
  const merged = mergeSyncSnapshots({ local, remotes: [remote] });
  expect(merged.settings.customEngines).toEqual([]);
  expect(merged.settings.searchCustomization.value.engineKeywords).toEqual({});
  expect(merged.settings.searchCustomization).toEqual({ value: { ...settings.search.customization, engineKeywords: {} },
    clock: 100, deviceId: 'device-a' });
});

it('remerges a pruned register with its original snapshot and converges across devices', () => {
  const defaults = createDefaultSettings();
  const engine = { id: 'custom-1', name: '文档', template: 'https://example.test/?q={query}', builtIn: false };
  const original = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    customEngines: [register(engine, 2)],
    searchCustomization: register({ ...defaults.search.customization, engineKeywords: { 'custom-1': 'docs' } }, 3),
  } });
  const removal = snapshot('device-b', { generation: 7, tombstones: [
    { entityType: 'custom-engine', id: engine.id, clock: 4, deviceId: 'device-b' },
  ] });
  const first = mergeSyncSnapshots({ local: original, remotes: [removal] });
  const remerged = mergeSyncSnapshots({ local: removal, remotes: [original, first] });
  expect(remerged.settings.searchCustomization).toEqual(first.settings.searchCustomization);
  expect(first.settings.searchCustomization.clock).toBe(5);
  expect(first.settings.searchCustomization.deviceId).toBe('device-a');
  expect(remerged.settings.searchCustomization.value.engineKeywords).toEqual({});
});

it('fails explicitly when pruning would overflow the observed logical clock', () => {
  const defaults = createDefaultSettings();
  const engine = { id: 'custom-1', name: '文档', template: 'https://example.test/?q={query}', builtIn: false };
  const local = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    appearance: register(createDefaultSettings().appearance, Number.MAX_SAFE_INTEGER, 'device-a'),
    customEngines: [register(engine, 2)],
    searchCustomization: register({ ...defaults.search.customization, engineKeywords: { 'custom-1': 'docs' } }, 3),
  } });
  const remote = snapshot('device-b', { tombstones: [
    { entityType: 'custom-engine', id: engine.id, clock: 4, deviceId: 'device-b' },
  ] });
  expect(() => mergeSyncSnapshots({ local, remotes: [remote] })).toThrow(/逻辑版本不能继续递增/);
});
