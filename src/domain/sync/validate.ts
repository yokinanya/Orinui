import { validateAppearance } from '@/domain/appearance';
import { fail } from '@/domain/errors';
import { validateLayout } from '@/domain/layout';
import { LIMITS } from '@/domain/limits';
import { BUILT_IN_ENGINES, resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import type { ShortcutIcon } from '@/domain/shortcut';
import { parseShortcutIcon } from '@/domain/shortcut-icon';
import { createDefaultSettings, validateSettings } from '@/domain/settings';
import { createDefaultSearchCustomization, validateSearchCustomization } from '@/domain/search-customization';
import { normalizeEngineName, normalizeFolderName, normalizeOptionalShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import { asRecord, exactKeys, identifier, integer, parseString, validateRegister, type RecordValue } from '@/domain/sync/validate-common';
import { parseSyncAsset } from '@/domain/sync/validate-assets';
import { LEGACY_GROUP_SYNC_SCHEMA_VERSION, LEGACY_FOLDER_SYNC_SCHEMA_VERSION, LEGACY_LAYOUT_SYNC_SCHEMA_VERSION,
  LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION, LEGACY_SYNC_SCHEMA_VERSION, LEGACY_STYLE_SYNC_SCHEMA_VERSION, PREVIOUS_SYNC_SCHEMA_VERSION,
  SYNC_SCHEMA_VERSION, type SupportedSyncSchemaVersion, type SyncAsset, type SyncEntityType,
  type SyncFolder, type SyncRegister, type SyncSettings, type SyncShortcut, type SyncSnapshot, type SyncTombstone } from '@/domain/sync/types';

interface SnapshotEnvelope extends RecordValue {
  readonly folders: unknown[];
  readonly shortcuts: unknown[];
  readonly assets: unknown[];
  readonly tombstones: unknown[];
}

function normalized(value: unknown, normalize: (input: string) => string, label: string): string {
  const text = parseString(value, label);
  const result = normalize(text);
  if (result !== text) fail(`${label}必须是已保存的规范格式`);
  return result;
}

function parseFolder(value: unknown): SyncFolder {
  const raw = asRecord(value, '同步文件夹');
  exactKeys(raw, ['id', 'name', 'position'], '同步文件夹');
  return { id: identifier(raw.id, '文件夹标识'),
    name: validateRegister(raw.name, '文件夹名称', (item) => normalized(item, normalizeFolderName, '文件夹名称')),
    position: validateRegister(raw.position, '文件夹位置', (item) => integer(item, '文件夹位置')) };
}

function parsePlacement(value: unknown): SyncShortcut['placement']['value'] {
  const raw = asRecord(value, '网站位置');
  exactKeys(raw, ['folderId', 'order'], '网站位置');
  const folderId = raw.folderId === null ? null : identifier(raw.folderId, '所属文件夹');
  return { folderId, order: integer(raw.order, '网站顺序') };
}

function parseShortcut(value: unknown): SyncShortcut {
  const raw = asRecord(value, '同步网站');
  exactKeys(raw, ['id', 'title', 'url', 'placement', 'icon'], '同步网站');
  return { id: identifier(raw.id, '网站标识'),
    title: validateRegister(raw.title, '网站标题', (item) => normalized(item, normalizeOptionalShortcutTitle, '网站标题')),
    url: validateRegister(raw.url, '网站地址', (item) => normalized(item, normalizeShortcutUrl, '网站地址')),
    placement: validateRegister(raw.placement, '网站位置', parsePlacement),
    icon: validateRegister(raw.icon, '网站图标', parseShortcutIcon) };
}

function parseEngine(value: unknown): SearchEngine {
  const raw = asRecord(value, '自定义搜索引擎');
  exactKeys(raw, ['id', 'name', 'template', 'builtIn'], '自定义搜索引擎');
  if (raw.builtIn !== false) fail('内置引擎不能写入自定义列表');
  if (typeof raw.name !== 'string' || typeof raw.template !== 'string') fail('自定义搜索引擎字段不正确');
  const name = normalizeEngineName(raw.name);
  if (name !== raw.name) fail('搜索引擎名称必须是已保存的规范格式');
  const template = validateEngineTemplate(raw.template);
  if (template !== raw.template) fail('搜索地址必须是已保存的规范格式');
  return { id: identifier(raw.id, '引擎标识'), name, template, builtIn: false };
}

function parseAppearance(value: unknown): SyncSettings['appearance']['value'] {
  const raw = asRecord(value, '外观设置');
  exactKeys(raw, ['theme', 'background', 'dynamicColor'], '外观设置');
  const background = asRecord(raw.background, '背景设置');
  const keys = background.kind === 'photo' || background.kind === 'motion' ? ['kind', 'assetId', 'maskStrength']
    : background.kind === 'solid' ? ['kind', 'color']
      : background.kind === 'gradient' ? ['kind', 'from', 'to', 'angle'] : ['kind'];
  exactKeys(background, keys, '背景设置');
  exactKeys(asRecord(raw.dynamicColor, '动态配色'), ['enabled', 'mode', 'seed'], '动态配色');
  return validateAppearance(value);
}

function parseLayout(value: unknown): SyncSettings['layout']['value'] {
  const raw = asRecord(value, '布局设置');
  exactKeys(raw, ['order', 'hidden', 'pageWidth', 'regionSpacing', 'columns', 'style', 'clockPosition'], '布局设置');
  return validateLayout(raw);
}

function parseSearchCustomization(value: unknown, schemaVersion: SupportedSyncSchemaVersion, deviceId: string): SyncSettings['searchCustomization'] {
  if (schemaVersion === LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION) {
    return { value: createDefaultSearchCustomization(), clock: 0, deviceId };
  }
  return validateRegister(value, '搜索自定义设置', validateSearchCustomization);
}

function parseSettings(value: unknown, schemaVersion: SupportedSyncSchemaVersion, deviceId: string): SyncSettings {
  const raw = asRecord(value, '同步设置');
  const keys = ['appearance', 'defaultEngineId', 'layout', 'clock', 'searchPreferences', 'shortcutPreferences', 'customEngines'];
  if (schemaVersion === SYNC_SCHEMA_VERSION) keys.push('searchCustomization');
  exactKeys(raw, keys, '同步设置');
  if (!Array.isArray(raw.customEngines)) fail('自定义搜索引擎格式不正确');
  if (raw.customEngines.length > LIMITS.customEngines) fail('自定义搜索引擎数量超限');
  const customEngines = raw.customEngines.map((item) => validateRegister(item, '自定义搜索引擎', parseEngine))
    .sort((left, right) => compareText(left.value.id, right.value.id));
  if (new Set(customEngines.map(({ value: engine }) => engine.id)).size !== customEngines.length) fail('自定义搜索引擎标识重复');
  if (customEngines.some(({ value: engine }) => BUILT_IN_ENGINES.some(({ id }) => id === engine.id))) fail('自定义引擎不能使用内置标识');
  const appearance = validateRegister(raw.appearance, '外观设置', parseAppearance);
  const layout = validateRegister(raw.layout, '布局设置', parseLayout);
  const defaultEngineId = validateRegister(raw.defaultEngineId, '默认引擎', (item) => parseString(item, '默认引擎'));
  const clock = validateRegister(raw.clock, '时钟设置', (item) => validateSettings({
    ...createDefaultSettings(), clock: item,
  }).clock);
  const searchPreferences = validateRegister(raw.searchPreferences, '搜索偏好', (item) => {
    const value = asRecord(item, '搜索偏好');
    exactKeys(value, ['width', 'autoFocus', 'openTarget'], '搜索偏好');
    const search = validateSettings({
      ...createDefaultSettings(), search: { ...createDefaultSettings().search, ...value },
    }).search;
    return { width: search.width, autoFocus: search.autoFocus, openTarget: search.openTarget };
  });
  const searchCustomization = parseSearchCustomization(raw.searchCustomization, schemaVersion, deviceId);
  const shortcutPreferences = validateRegister(raw.shortcutPreferences, '网站偏好', (item) => {
    const value = asRecord(item, '网站偏好');
    exactKeys(value, ['showNames', 'openTarget'], '网站偏好');
    return validateSettings({ ...createDefaultSettings(), shortcuts: value }).shortcuts;
  });
  const settings = { appearance, defaultEngineId, layout, clock, searchPreferences, searchCustomization, shortcutPreferences, customEngines };
  const rawSettings = {
    appearance: appearance.value,
    search: { defaultEngineId: defaultEngineId.value, customEngines: customEngines.map(({ value: engine }) => engine),
      ...searchPreferences.value, customization: searchCustomization.value },
    shortcuts: shortcutPreferences.value, layout: layout.value, clock: clock.value,
  };
  validateSettings(rawSettings);
  return settings;
}

function parseTombstone(value: unknown): SyncTombstone {
  const raw = asRecord(value, '删除墓碑');
  exactKeys(raw, ['entityType', 'id', 'clock', 'deviceId'], '删除墓碑');
  const entityTypes: readonly SyncEntityType[] = ['folder', 'shortcut', 'asset', 'custom-engine'];
  if (typeof raw.entityType !== 'string' || !entityTypes.includes(raw.entityType as SyncEntityType)) fail('墓碑实体类型不正确');
  const entityType = raw.entityType as SyncEntityType;
  const id = identifier(raw.id, '墓碑标识');
  if (entityType === 'custom-engine' && BUILT_IN_ENGINES.some((engine) => engine.id === id)) fail('内置搜索引擎不能删除');
  return { entityType, id,
    clock: integer(raw.clock, '墓碑时钟'), deviceId: identifier(raw.deviceId, '墓碑设备标识') };
}

function uniqueIds<T extends { readonly id: string }>(items: readonly T[], label: string): void {
  if (new Set(items.map(({ id }) => id)).size !== items.length) fail(`${label}标识重复`);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function validateSnapshotLimits(snapshot: SyncSnapshot): void {
  if (snapshot.folders.length > LIMITS.folders) fail('文件夹数量超限');
  if (snapshot.shortcuts.length > LIMITS.shortcuts) fail('网站数量超限');
}

function requireAsset({ assets, id, kind, label }: {
  readonly assets: ReadonlyMap<string, SyncAsset>; readonly id: string;
  readonly kind: SyncAsset['kind']; readonly label: string;
}): SyncAsset {
  const asset = assets.get(id);
  if (!asset || asset.kind !== kind) fail(`${label}资源引用不存在`);
  return asset;
}

function collectShortcutAssetRefs({ snapshot, folderIds, assets }: {
  readonly snapshot: SyncSnapshot; readonly folderIds: ReadonlySet<string>;
  readonly assets: ReadonlyMap<string, SyncAsset>;
}): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const shortcut of snapshot.shortcuts) {
    const folderId = shortcut.placement.value.folderId;
    if (folderId !== null && !folderIds.has(folderId) &&
      !snapshot.tombstones.some((item) => item.entityType === 'folder' && item.id === folderId)) fail('网站所属文件夹引用不存在');
    if (shortcut.icon.value.kind !== 'asset') continue;
    const assetId = shortcut.icon.value.assetId;
    requireAsset({ assets, id: assetId, kind: 'icon', label: '网站图标' });
    if (shortcut.icon.value.color && assets.get(assetId)?.mime !== 'image/svg+xml') fail('SVG 图标颜色只能用于 SVG 资源');
    refs.add(assetId);
  }
  return refs;
}

function collectBackgroundAssetRef(snapshot: SyncSnapshot, assets: ReadonlyMap<string, SyncAsset>): string | null {
  const background = snapshot.settings.appearance.value.background;
  if (background.kind !== 'photo' && background.kind !== 'motion') return null;
  const asset = requireAsset({ assets, id: background.assetId, kind: 'background', label: '背景媒体' });
  if ((background.kind === 'motion') !== (asset.motion !== null)) fail('背景类型与媒体动态属性不匹配');
  return background.assetId;
}

function validateAssetSet(snapshot: SyncSnapshot, refs: ReadonlySet<string>): void {
  if (snapshot.assets.some(({ id, kind }) => kind === 'icon' && !refs.has(id))) fail('存在未引用的网站图标');
}

function validateSettingsReferences(snapshot: SyncSnapshot): void {
  const custom = snapshot.settings.customEngines.map(({ value }) => value);
  if (!resolveEngine(snapshot.settings.defaultEngineId.value, custom)) fail('默认搜索引擎引用不存在');
}

function validateReferences(snapshot: SyncSnapshot): void {
  const folderIds = new Set(snapshot.folders.map(({ id }) => id));
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  validateSnapshotLimits(snapshot);
  const refs = new Set(collectShortcutAssetRefs({ snapshot, folderIds, assets }));
  const backgroundRef = collectBackgroundAssetRef(snapshot, assets);
  if (backgroundRef) refs.add(backgroundRef);
  validateAssetSet(snapshot, refs);
  validateSettingsReferences(snapshot);
}

function isSupportedSchemaVersion(value: unknown): value is SupportedSyncSchemaVersion {
  return value === LEGACY_SYNC_SCHEMA_VERSION || value === LEGACY_STYLE_SYNC_SCHEMA_VERSION
    || value === LEGACY_LAYOUT_SYNC_SCHEMA_VERSION || value === LEGACY_GROUP_SYNC_SCHEMA_VERSION
    || value === LEGACY_FOLDER_SYNC_SCHEMA_VERSION || value === PREVIOUS_SYNC_SCHEMA_VERSION
    || value === LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION || value === SYNC_SCHEMA_VERSION;
}

function validateSnapshotEnvelope(raw: RecordValue): SupportedSyncSchemaVersion {
  const schemaVersion = raw.schemaVersion;
  if (!isSupportedSchemaVersion(schemaVersion)) fail('同步快照版本不受支持');
  if (schemaVersion !== LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION && schemaVersion !== SYNC_SCHEMA_VERSION) {
    fail('旧分组同步协议不兼容当前文件夹版本；需要重新启用同步并显式重置远端库');
  }
  exactKeys(raw, ['schemaVersion', 'vaultId', 'deviceId', 'generation', 'folders', 'shortcuts', 'settings', 'assets', 'tombstones'], '同步快照');
  if (!Array.isArray(raw.folders) || !Array.isArray(raw.shortcuts) || !Array.isArray(raw.assets) || !Array.isArray(raw.tombstones)) fail('同步快照列表格式不正确');
  if (raw.folders.length > LIMITS.folders) fail('文件夹数量超限');
  if (raw.shortcuts.length > LIMITS.shortcuts) fail('网站数量超限');
  return schemaVersion;
}

function parseSnapshotFields(raw: SnapshotEnvelope, schemaVersion: SupportedSyncSchemaVersion): SyncSnapshot {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: identifier(raw.vaultId, '同步库标识'), deviceId: identifier(raw.deviceId, '设备标识'),
    generation: integer(raw.generation, '快照代次'),
    folders: raw.folders.map(parseFolder).sort((left, right) => compareText(left.id, right.id)),
    shortcuts: raw.shortcuts.map(parseShortcut).sort((left, right) => compareText(left.id, right.id)),
    settings: parseSettings(raw.settings, schemaVersion, identifier(raw.deviceId, '设备标识')),
    assets: raw.assets.map((item) => parseSyncAsset(item, schemaVersion)).sort((left, right) => compareText(left.id, right.id)),
    tombstones: raw.tombstones.map(parseTombstone).sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.id, right.id)),
  };
}

function validateSnapshotEntities(snapshot: SyncSnapshot): void {
  uniqueIds(snapshot.folders, '文件夹'); uniqueIds(snapshot.shortcuts, '网站'); uniqueIds(snapshot.assets, '图片资源');
  const tombstoneKeys = snapshot.tombstones.map(({ entityType, id }) => `${entityType}:${id}`);
  if (new Set(tombstoneKeys).size !== tombstoneKeys.length) fail('墓碑标识重复');
  const liveKeys = [
    ...snapshot.folders.map(({ id }) => `folder:${id}`),
    ...snapshot.shortcuts.map(({ id }) => `shortcut:${id}`),
    ...snapshot.assets.map(({ id }) => `asset:${id}`),
    ...snapshot.settings.customEngines.map(({ value: engine }) => `custom-engine:${engine.id}`),
  ];
  if (liveKeys.some((key) => tombstoneKeys.includes(key))) fail('实体不能同时处于存活和删除状态');
}

export function parseSyncSnapshot(value: unknown): SyncSnapshot {
  const raw = asRecord(value, '同步快照');
  const schemaVersion = validateSnapshotEnvelope(raw);
  const snapshot = parseSnapshotFields(raw as SnapshotEnvelope, schemaVersion);
  validateSnapshotEntities(snapshot);
  validateReferences(snapshot);
  return snapshot;
}
