import { validateAppearance } from '@/domain/appearance';
import { fail } from '@/domain/errors';
import { validateLayout } from '@/domain/layout';
import { LIMITS } from '@/domain/limits';
import { BUILT_IN_ENGINES, resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import type { ShortcutIcon } from '@/domain/shortcut';
import { parseShortcutIcon } from '@/domain/shortcut-icon';
import { createDefaultSettings, validateSettings } from '@/domain/settings';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { normalizeEngineName, normalizeGroupName, normalizeShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import { asRecord, exactKeys, identifier, integer, parseString, validateRegister, type RecordValue } from '@/domain/sync/validate-common';
import { parseSyncAsset } from '@/domain/sync/validate-assets';
import { SYNC_SCHEMA_VERSION, type SyncAsset, type SyncEntityType, type SyncGroup, type SyncRegister, type SyncSettings, type SyncShortcut, type SyncSnapshotV1, type SyncTombstone } from '@/domain/sync/types';

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_ASSET_COUNT = LIMITS.shortcuts + 1;
interface SnapshotEnvelope extends RecordValue {
  readonly groups: unknown[];
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

function parseGroup(value: unknown): SyncGroup {
  const raw = asRecord(value, '同步分组');
  exactKeys(raw, ['id', 'name', 'colorRole', 'position'], '同步分组');
  const colorRole = (item: unknown) => {
    if (item !== null && item !== 'primary' && item !== 'secondary' && item !== 'tertiary') fail('分组颜色角色不正确');
    return item as SyncGroup['colorRole']['value'];
  };
  return { id: identifier(raw.id, '分组标识'), name: validateRegister(raw.name, '分组名称', (item) => normalized(item, normalizeGroupName, '分组名称')),
    colorRole: validateRegister(raw.colorRole, '分组颜色', colorRole),
    position: validateRegister(raw.position, '分组位置', (item) => integer(item, '分组位置')) };
}

function parsePlacement(value: unknown): SyncShortcut['placement']['value'] {
  const raw = asRecord(value, '网站位置');
  exactKeys(raw, ['groupId', 'order'], '网站位置');
  return { groupId: identifier(raw.groupId, '所属分组'), order: integer(raw.order, '网站顺序') };
}

function parseShortcut(value: unknown): SyncShortcut {
  const raw = asRecord(value, '同步网站');
  exactKeys(raw, ['id', 'title', 'url', 'placement', 'icon'], '同步网站');
  return { id: identifier(raw.id, '网站标识'),
    title: validateRegister(raw.title, '网站标题', (item) => normalized(item, normalizeShortcutTitle, '网站标题')),
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
  const keys = background.kind === 'photo' ? ['kind', 'assetId', 'maskStrength']
    : background.kind === 'solid' ? ['kind', 'color']
      : background.kind === 'gradient' ? ['kind', 'from', 'to', 'angle'] : ['kind'];
  exactKeys(background, keys, '背景设置');
  exactKeys(asRecord(raw.dynamicColor, '动态配色'), ['enabled', 'mode', 'seed'], '动态配色');
  return validateAppearance(value);
}

function parseLayout(value: unknown): SyncSettings['layout']['value'] {
  const raw = asRecord(value, '布局设置');
  exactKeys(raw, ['order', 'hidden', 'pageWidth', 'regionSpacing', 'columns'], '布局设置');
  return validateLayout(value);
}

function parseLegacyLayout(value: unknown): SyncSettings['layout']['value'] {
  const raw = asRecord(value, '布局设置');
  exactKeys(raw, ['order', 'hidden'], '布局设置');
  return validateLayout({ ...DEFAULT_LAYOUT, ...raw });
}

function parseSettings(value: unknown): SyncSettings {
  const raw = asRecord(value, '同步设置');
  exactKeys(raw, ['appearance', 'defaultEngineId', 'layout', 'clock', 'searchPreferences', 'shortcutPreferences', 'customEngines'], '同步设置');
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
  const shortcutPreferences = validateRegister(raw.shortcutPreferences, '网站偏好', (item) => {
    const value = asRecord(item, '网站偏好');
    exactKeys(value, ['showNames', 'openTarget'], '网站偏好');
    return validateSettings({ ...createDefaultSettings(), shortcuts: value }).shortcuts;
  });
  const settings = { appearance, defaultEngineId, layout, clock, searchPreferences, shortcutPreferences, customEngines };
  const rawSettings = {
    appearance: appearance.value,
    search: { defaultEngineId: defaultEngineId.value, customEngines: customEngines.map(({ value: engine }) => engine), ...searchPreferences.value },
    shortcuts: shortcutPreferences.value, layout: layout.value, clock: clock.value,
  };
  validateSettings(rawSettings);
  return settings;
}

function parseTombstone(value: unknown): SyncTombstone {
  const raw = asRecord(value, '删除墓碑');
  exactKeys(raw, ['entityType', 'id', 'clock', 'deviceId'], '删除墓碑');
  const entityTypes: readonly SyncEntityType[] = ['group', 'shortcut', 'asset', 'custom-engine'];
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

function validateSnapshotLimits(snapshot: SyncSnapshotV1): void {
  if (snapshot.groups.length < 1 || snapshot.groups.length > LIMITS.groups) fail('分组数量超限');
  if (snapshot.shortcuts.length > LIMITS.shortcuts) fail('网站数量超限');
}

function requireAsset({ assets, id, kind, label }: {
  readonly assets: ReadonlyMap<string, SyncAsset>; readonly id: string;
  readonly kind: SyncAsset['kind']; readonly label: string;
}): void {
  const asset = assets.get(id);
  if (!asset || asset.kind !== kind) fail(`${label}资源引用不存在`);
}

function collectShortcutAssetRefs({ snapshot, groupIds, assets }: {
  readonly snapshot: SyncSnapshotV1; readonly groupIds: ReadonlySet<string>;
  readonly assets: ReadonlyMap<string, SyncAsset>;
}): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const shortcut of snapshot.shortcuts) {
    const groupId = shortcut.placement.value.groupId;
    if (!groupIds.has(groupId)) fail('网站所属分组引用不存在');
    if (shortcut.icon.value.kind !== 'asset') continue;
    const assetId = shortcut.icon.value.assetId;
    requireAsset({ assets, id: assetId, kind: 'icon', label: '网站图标' });
    if (shortcut.icon.value.color && assets.get(assetId)?.mime !== 'image/svg+xml') fail('SVG 图标颜色只能用于 SVG 资源');
    refs.add(assetId);
  }
  return refs;
}

function collectBackgroundAssetRef(snapshot: SyncSnapshotV1, assets: ReadonlyMap<string, SyncAsset>): string | null {
  const background = snapshot.settings.appearance.value.background;
  if (background.kind !== 'photo') return null;
  requireAsset({ assets, id: background.assetId, kind: 'background', label: '背景图片' });
  return background.assetId;
}

function validateAssetSet(snapshot: SyncSnapshotV1, refs: ReadonlySet<string>): void {
  if (refs.size !== snapshot.assets.length || snapshot.assets.some(({ id }) => !refs.has(id))) fail('存在未引用的图片资源');
  let bytes = 0;
  for (const asset of snapshot.assets) bytes += asset.byteLength;
  if (bytes > MAX_ASSET_BYTES) fail('同步图片资源总量超过 50 MiB');
}

function validateSettingsReferences(snapshot: SyncSnapshotV1): void {
  const custom = snapshot.settings.customEngines.map(({ value }) => value);
  if (!resolveEngine(snapshot.settings.defaultEngineId.value, custom)) fail('默认搜索引擎引用不存在');
  for (const group of snapshot.groups) {
    if (group.id === snapshot.defaultGroupId.value && group.colorRole.value !== 'primary') fail('默认分组必须使用主色');
  }
}

function validateReferences(snapshot: SyncSnapshotV1): void {
  const groupIds = new Set(snapshot.groups.map(({ id }) => id));
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  if (!groupIds.has(snapshot.defaultGroupId.value)) fail('默认分组引用不存在');
  validateSnapshotLimits(snapshot);
  const refs = new Set(collectShortcutAssetRefs({ snapshot, groupIds, assets }));
  const backgroundRef = collectBackgroundAssetRef(snapshot, assets);
  if (backgroundRef) refs.add(backgroundRef);
  validateAssetSet(snapshot, refs);
  validateSettingsReferences(snapshot);
}

function validateSnapshotEnvelope(raw: RecordValue): asserts raw is SnapshotEnvelope {
  exactKeys(raw, ['schemaVersion', 'vaultId', 'deviceId', 'generation', 'defaultGroupId', 'groups', 'shortcuts', 'settings', 'assets', 'tombstones'], '同步快照');
  if (raw.schemaVersion !== SYNC_SCHEMA_VERSION) fail('同步快照版本不受支持');
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.shortcuts) || !Array.isArray(raw.assets) || !Array.isArray(raw.tombstones)) fail('同步快照列表格式不正确');
  if (raw.groups.length > LIMITS.groups) fail('分组数量超限');
  if (raw.shortcuts.length > LIMITS.shortcuts) fail('网站数量超限');
  if (raw.assets.length > MAX_ASSET_COUNT) fail('图片资源数量超限');
}

function migrateSnapshotV1(value: unknown): unknown {
  const raw = asRecord(value, '同步快照');
  if (raw.schemaVersion !== 1) return value;
  exactKeys(raw, ['schemaVersion', 'vaultId', 'deviceId', 'generation', 'defaultGroupId', 'groups', 'shortcuts', 'settings', 'assets', 'tombstones'], '同步快照');
  const settings = asRecord(raw.settings, '同步设置');
  exactKeys(settings, ['appearance', 'defaultEngineId', 'layout', 'clock', 'customEngines'], '同步设置');
  const defaults = createDefaultSettings();
  const layout = validateRegister(settings.layout, '布局设置', parseLegacyLayout);
  const clock = validateRegister(settings.clock, '时钟设置', (item) => {
    const old = asRecord(item, '时钟设置');
    exactKeys(old, ['format'], '时钟设置');
    return { ...defaults.clock, ...validateSettings({ ...defaults, clock: { ...defaults.clock, ...old } }).clock };
  });
  const deviceId = identifier(raw.deviceId, '设备标识');
  return {
    ...raw,
    schemaVersion: SYNC_SCHEMA_VERSION,
    settings: {
      ...settings,
      layout,
      clock,
      searchPreferences: { value: {
        width: defaults.search.width, autoFocus: defaults.search.autoFocus, openTarget: defaults.search.openTarget,
      }, clock: 0, deviceId },
      shortcutPreferences: { value: defaults.shortcuts, clock: 0, deviceId },
    },
  };
}

function parseSnapshotFields(raw: SnapshotEnvelope): SyncSnapshotV1 {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: identifier(raw.vaultId, '同步库标识'), deviceId: identifier(raw.deviceId, '设备标识'),
    generation: integer(raw.generation, '快照代次'),
    defaultGroupId: validateRegister(raw.defaultGroupId, '默认分组', (item) => parseString(item, '默认分组')),
    groups: raw.groups.map(parseGroup).sort((left, right) => compareText(left.id, right.id)),
    shortcuts: raw.shortcuts.map(parseShortcut).sort((left, right) => compareText(left.id, right.id)),
    settings: parseSettings(raw.settings),
    assets: raw.assets.map(parseSyncAsset).sort((left, right) => compareText(left.id, right.id)),
    tombstones: raw.tombstones.map(parseTombstone).sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.id, right.id)),
  };
}

function validateSnapshotEntities(snapshot: SyncSnapshotV1): void {
  uniqueIds(snapshot.groups, '分组'); uniqueIds(snapshot.shortcuts, '网站'); uniqueIds(snapshot.assets, '图片资源');
  const tombstoneKeys = snapshot.tombstones.map(({ entityType, id }) => `${entityType}:${id}`);
  if (new Set(tombstoneKeys).size !== tombstoneKeys.length) fail('墓碑标识重复');
  const liveKeys = [
    ...snapshot.groups.map(({ id }) => `group:${id}`),
    ...snapshot.shortcuts.map(({ id }) => `shortcut:${id}`),
    ...snapshot.assets.map(({ id }) => `asset:${id}`),
    ...snapshot.settings.customEngines.map(({ value: engine }) => `custom-engine:${engine.id}`),
  ];
  if (liveKeys.some((key) => tombstoneKeys.includes(key))) fail('实体不能同时处于存活和删除状态');
}

export function parseSyncSnapshot(value: unknown): SyncSnapshotV1 {
  const raw = asRecord(migrateSnapshotV1(value), '同步快照');
  validateSnapshotEnvelope(raw);
  const snapshot = parseSnapshotFields(raw);
  validateSnapshotEntities(snapshot);
  validateReferences(snapshot);
  return snapshot;
}
