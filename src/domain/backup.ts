import { fail } from '@/domain/errors';
import { isGroupColorRole, type Group } from '@/domain/group';
import { imageOutputSize } from '@/domain/image';
import { validateLayout } from '@/domain/layout';
import { LIMITS } from '@/domain/limits';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName, normalizeGroupName, normalizeShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import type { AppSettings } from '@/domain/settings';
import { validateBackupSettings } from '@/domain/backup-settings';
import type { ImageAsset } from '@/domain/asset';
import type { Shortcut } from '@/domain/shortcut';
import { parseShortcutIcon } from '@/domain/shortcut-icon';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';

export const BACKUP_VERSION = 2;
export const BACKUP_JSON_LIMIT = 70 * 1024 * 1024;
export const BACKUP_IMAGE_LIMIT = 50 * 1024 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface BackupAsset {
  readonly id: string;
  readonly kind: ImageAsset['kind'];
  readonly mime: ImageAsset['mime'];
  readonly width: number;
  readonly height: number;
  readonly sourceUrl: string | null;
  readonly data: string;
}

export interface BackupDocument {
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly groups: readonly Group[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly BackupAsset[];
}

export interface BackupPreview {
  readonly groupCount: number;
  readonly shortcutCount: number;
  readonly assetCount: number;
  readonly defaultGroup: string;
  readonly engine: string;
  readonly document: BackupDocument;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== allowed.length || !allowed.every((key) => Object.hasOwn(value, key))) {
    fail(`${label}字段不正确`);
  }
}

function textField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不能为空`);
  return value;
}

function validateGroups(value: unknown): Group[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.groups) fail('分组数量不符合限制');
  const ids = new Set<string>();
  const defaults: string[] = [];
  const result = value.map((value, index) => {
    const raw = record(value, '分组');
    exactKeys(raw, ['id', 'name', 'colorRole', 'order', 'isDefault'], '分组');
    const id = textField(raw.id, '分组标识');
    if (ids.has(id)) fail('分组标识不能重复');
    ids.add(id);
    const name = normalizeGroupName(textField(raw.name, '分组名称'));
    if (name !== raw.name) fail('分组名称必须是已保存的规范格式');
    if (raw.order !== index || typeof raw.isDefault !== 'boolean') fail('分组顺序或默认标识不正确');
    if (raw.isDefault) defaults.push(id);
    if (raw.colorRole !== null && !isGroupColorRole(raw.colorRole)) fail('分组颜色角色不正确');
    if (raw.isDefault && raw.colorRole !== 'primary') fail('默认分组必须使用主色');
    return { id, name, colorRole: raw.colorRole, order: index, isDefault: raw.isDefault } as Group;
  });
  if (defaults.length !== 1) fail('必须恰好有一个默认分组');
  return result;
}

function validateShortcuts(value: unknown, groups: readonly Group[]): Shortcut[] {
  if (!Array.isArray(value) || value.length > LIMITS.shortcuts) fail('网站数量不符合限制');
  const groupIds = new Set(groups.map((group) => group.id));
  const ids = new Set<string>();
  const orders = new Map<string, Set<number>>();
  const result = value.map((value) => {
    const raw = record(value, '网站');
    exactKeys(raw, ['id', 'groupId', 'title', 'url', 'icon', 'iconSourceUrl', 'order'], '网站');
    const id = textField(raw.id, '网站标识');
    const groupId = textField(raw.groupId, '网站分组');
    if (ids.has(id) || !groupIds.has(groupId)) fail('网站标识重复或所属分组不存在');
    ids.add(id);
    const title = normalizeShortcutTitle(textField(raw.title, '网站名称'));
    if (title !== raw.title) fail('网站名称必须是已保存的规范格式');
    const url = normalizeShortcutUrl(textField(raw.url, '网站地址'));
    if (url !== raw.url) fail('网站地址必须是已保存的规范格式');
    if (!Number.isSafeInteger(raw.order) || (raw.order as number) < 0) fail('网站顺序不正确');
    const orderSet = orders.get(groupId) ?? new Set<number>();
    if (orderSet.has(raw.order as number)) fail('同一分组内网站顺序不能重复');
    orderSet.add(raw.order as number);
    orders.set(groupId, orderSet);
    const sourceUrl = validateSourceUrl(raw.iconSourceUrl, '图标来源地址');
    return { id, groupId, title, url, icon: parseShortcutIcon(raw.icon), iconSourceUrl: sourceUrl, order: raw.order as number };
  });
  for (const orderSet of orders.values()) {
    if ([...orderSet].some((order, index) => order !== index)) fail('网站顺序必须连续');
  }
  return result;
}

function validateAssetKind(value: unknown): ImageAsset['kind'] {
  if (value !== 'icon' && value !== 'background') fail('图片资源类型不正确');
  return value;
}

function validateAssetMime(value: unknown, kind: ImageAsset['kind']): ImageAsset['mime'] {
  if (value !== 'image/png' && value !== 'image/jpeg' && value !== 'image/webp' && value !== 'image/svg+xml') fail('图片资源格式不正确');
  if (kind === 'icon' && value !== 'image/png' && value !== 'image/svg+xml') fail('网站图标必须是 PNG 或 SVG');
  if (kind === 'background' && value === 'image/svg+xml') fail('SVG 不能作为背景图片');
  return value;
}

function validateAssetDimensions(width: unknown, height: unknown, kind: ImageAsset['kind']): { width: number; height: number } {
  if (typeof width !== 'number' || typeof height !== 'number') fail('图片尺寸不正确');
  imageOutputSize({ width, height, kind });
  const edgeLimit = kind === 'icon' ? 1024 : 2560;
  if (Math.max(width, height) > edgeLimit) fail('图片最长边超出限制');
  return { width, height };
}

function validateAssetData(value: unknown): string {
  const data = textField(value, '图片内容');
  if (!BASE64.test(data)) fail('图片 Base64 格式不正确');
  return data;
}

function validateAsset(value: unknown): BackupAsset {
  const raw = record(value, '图片资源');
  exactKeys(raw, ['id', 'kind', 'mime', 'width', 'height', 'sourceUrl', 'data'], '图片资源');
  const kind = validateAssetKind(raw.kind);
  const mime = validateAssetMime(raw.mime, kind);
  const { width, height } = validateAssetDimensions(raw.width, raw.height, kind);
  const sourceUrl = validateSourceUrl(raw.sourceUrl, '图片来源地址');
  const data = validateAssetData(raw.data);
  return { id: textField(raw.id, '图片标识'), kind, mime, width, height, sourceUrl, data };
}

function validateSourceUrl(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail(`${label}不正确`);
  const location = validateRemoteImageUrl(value);
  if (location.url.href !== value) fail(`${label}必须使用规范地址格式`);
  return value;
}

interface AssetReferenceInput {
  readonly groups: readonly Group[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly BackupAsset[];
}

function validateBackgroundReference(background: AppSettings['appearance']['background'], assetMap: ReadonlyMap<string, BackupAsset>): string | null {
  if (background.kind !== 'photo') return null;
  const asset = assetMap.get(background.assetId);
  if (!asset || asset.kind !== 'background') fail('照片背景引用不存在');
  return asset.id;
}

function validateShortcutAssetReference(shortcut: Shortcut, assetMap: ReadonlyMap<string, BackupAsset>): string | null {
  if (shortcut.icon.kind !== 'asset') {
    if (shortcut.iconSourceUrl !== null) fail('文字或内置图标不能带图片来源地址');
    return null;
  }
  const asset = assetMap.get(shortcut.icon.assetId);
  if (!asset || asset.kind !== 'icon') fail('网站图片图标引用不存在');
  if (shortcut.icon.color && asset.mime !== 'image/svg+xml') fail('SVG 图标颜色只能用于 SVG 资源');
  if (shortcut.iconSourceUrl !== asset.sourceUrl) fail('网站图标来源地址不一致');
  return asset.id;
}

function validateAssetReferences(input: AssetReferenceInput): void {
  const { groups, shortcuts, settings, assets } = input;
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  if (assetMap.size !== assets.length) fail('图片标识不能重复');
  const references = new Set<string>();
  const backgroundId = validateBackgroundReference(settings.appearance.background, assetMap);
  if (backgroundId) references.add(backgroundId);
  for (const shortcut of shortcuts) {
    const assetId = validateShortcutAssetReference(shortcut, assetMap);
    if (assetId) references.add(assetId);
  }
  if (references.size !== assets.length) fail('备份包含未被引用的图片');
  if (groups.length === 0) fail('备份缺少分组');
}

function validateBackupHeader(version: unknown, exportedAt: unknown): string {
  if (version !== 1 && version !== BACKUP_VERSION) fail('备份版本不受支持');
  if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) fail('备份时间不正确');
  return exportedAt;
}

function estimatedAssetBytes(asset: BackupAsset): number {
  const padding = asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0;
  return Math.floor(asset.data.length * 3 / 4) - padding;
}

function validateBackupAssets(value: unknown): BackupAsset[] {
  if (!Array.isArray(value) || value.length > LIMITS.shortcuts + 1) fail('图片资源数量不正确');
  const assets = value.map(validateAsset);
  let bytes = 0;
  for (const asset of assets) bytes += estimatedAssetBytes(asset);
  if (bytes > BACKUP_IMAGE_LIMIT) fail('图片资源总量超过 50 MiB');
  return assets;
}

export function parseBackup(value: unknown): BackupPreview {
  const raw = record(value, '备份文件');
  exactKeys(raw, ['version', 'exportedAt', 'groups', 'shortcuts', 'settings', 'assets'], '备份文件');
  const exportedAt = validateBackupHeader(raw.version, raw.exportedAt);
  const groups = validateGroups(raw.groups);
  const shortcuts = validateShortcuts(raw.shortcuts, groups);
  const settings = validateBackupSettings(raw.settings, raw.version === 1);
  const assets = validateBackupAssets(raw.assets);
  validateAssetReferences({ groups, shortcuts, settings, assets });
  const engine = resolveEngine(settings.search.defaultEngineId, settings.search.customEngines);
  if (!engine) fail('默认搜索引擎不存在');
  return { groupCount: groups.length, shortcutCount: shortcuts.length, assetCount: assets.length,
    defaultGroup: groups.find((group) => group.isDefault)?.name ?? '', engine: engine.name,
    document: { version: BACKUP_VERSION, exportedAt, groups, shortcuts, settings, assets } };
}

export function validateCustomEngine(input: { readonly name: string; readonly template: string }): Pick<SearchEngine, 'name' | 'template'> {
  return { name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) };
}
