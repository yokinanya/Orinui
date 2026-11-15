import type { MediaAsset, MediaAssetMotion } from '@/domain/asset';
import type { BackupSettings } from '@/domain/backup-settings';
import { fail } from '@/domain/errors';
import { CURRENT_BACKUP_VERSION, LEGACY_FLAT_FOLDER_BACKUP_VERSION, type SupportedBackupVersion } from '@/domain/backup-settings';
import { assertFolderTree, type Folder } from '@/domain/folder';
import { imageOutputSize } from '@/domain/image';
import { LIMITS } from '@/domain/limits';
import { normalizeFolderName, normalizeOptionalAssetName, normalizeOptionalShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import type { Shortcut } from '@/domain/shortcut';
import { parseShortcutIcon } from '@/domain/shortcut-icon';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';
import type { BackupAsset } from '@/domain/backup';

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== allowed.length || !allowed.every((key) => Object.hasOwn(value, key))) fail(`${label}字段不正确`);
}

function textField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不能为空`);
  return value;
}

function validateSourceUrl(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail(`${label}不正确`);
  const location = validateRemoteImageUrl(value);
  if (location.url.href !== value) fail(`${label}必须使用规范地址格式`);
  return value;
}

/**
 * ZIP 文件夹条目。
 *
 * 当前格式（12）要求完整、无环的父引用树；11 及更早是扁平列表（`order` 必须等于数组
 * 下标，这是当时的合同），升级时补 `parentId: null`，并保留既有 ID、名称、顺序与主页格位。
 *
 * 当前格式的 `order` 只是**同层**顺序，不是数组下标：合法删除只提升被删项、不重编号目标层
 * 既有项，同步物化也保留寄存器原值，因此稀疏（如 0、2）与并列（两项都是 2）都必须原样
 * 接受并按 `order` 其次 `id` 稳定显示。这里只拒绝负数、非整数、重复 ID 与非法父引用树，
 * 不重编号、不规范化。
 */
export function validateBackupFolders(value: unknown, formatVersion: SupportedBackupVersion = CURRENT_BACKUP_VERSION): Folder[] {
  if (!Array.isArray(value) || value.length > LIMITS.folders) fail('文件夹数量不符合限制');
  // `LEGACY_FLAT_FOLDER_BACKUP_VERSION` 是**最后一个扁平版本**（已提交的 11 就是扁平
  // `id/name/order`，`order` 必须等于下标），带 `parentId` 的树从下一个版本才开始。
  const tree = formatVersion > LEGACY_FLAT_FOLDER_BACKUP_VERSION;
  const ids = new Set<string>();
  const folders = value.map((item, index) => {
    const raw = record(item, '文件夹');
    exactKeys(raw, tree ? ['id', 'parentId', 'name', 'order'] : ['id', 'name', 'order'], '文件夹');
    const id = textField(raw.id, '文件夹标识');
    if (ids.has(id)) fail('文件夹标识不能重复');
    ids.add(id);
    const name = normalizeFolderName(textField(raw.name, '文件夹名称'));
    if (name !== raw.name) fail('文件夹名称必须是已保存的规范格式');
    if (!Number.isSafeInteger(raw.order) || (raw.order as number) < 0) fail('文件夹顺序不正确');
    // 扁平列表是历史合同：位置即数组下标。当前树格式不再施加这条限制。
    if (!tree && raw.order !== index) fail('文件夹顺序不正确');
    const parentId = tree ? (raw.parentId === null ? null : textField(raw.parentId, '父文件夹')) : null;
    return { id, parentId, name, order: raw.order as number };
  });
  assertFolderTree(folders);
  return folders;
}

interface ValidateShortcutInput {
  readonly value: unknown;
  readonly folderIds: ReadonlySet<string>;
  readonly ids: Set<string>;
  readonly orders: Map<string, Set<number>>;
  readonly legacy: boolean;
}

function validateShortcut(input: ValidateShortcutInput): Shortcut {
  const { value, folderIds, ids, orders, legacy } = input;
  const raw = record(value, '网站');
  exactKeys(raw, ['id', 'folderId', 'title', 'url', 'icon', 'iconSourceUrl', 'order'], '网站');
  const id = textField(raw.id, '网站标识');
  const folderId = raw.folderId === null ? null : textField(raw.folderId, '网站文件夹');
  if (ids.has(id) || (folderId !== null && !folderIds.has(folderId))) fail('网站标识重复或所属文件夹不存在');
  ids.add(id);
  // 网站名称允许为空（显示时改用地址域名），因此不能用要求非空的文本读取。
  if (typeof raw.title !== 'string') fail('网站名称格式不正确');
  const title = normalizeOptionalShortcutTitle(raw.title);
  if (title !== raw.title) fail('网站名称必须是已保存的规范格式');
  const url = normalizeShortcutUrl(textField(raw.url, '网站地址'));
  if (url !== raw.url) fail('网站地址必须是已保存的规范格式');
  if (!Number.isSafeInteger(raw.order) || (raw.order as number) < 0) fail('网站顺序不正确');
  if (legacy) {
    // 扁平文件夹时代每次删除都会重排容器，历史合同因此要求连续且不重复；不弱化旧格式。
    const key = folderId ?? '';
    const groupOrders = orders.get(key) ?? new Set<number>();
    if (groupOrders.has(raw.order as number)) fail('同一文件夹内网站顺序不能重复');
    groupOrders.add(raw.order as number);
    orders.set(key, groupOrders);
  }
  return { id, folderId, title, url, icon: parseShortcutIcon(raw.icon),
    iconSourceUrl: validateSourceUrl(raw.iconSourceUrl, '图标来源地址'), order: raw.order as number };
}

/**
 * ZIP 网站条目。
 *
 * 当前格式（12）的 `order` 与文件夹同构：同容器内的**相对**位置。合法删除只提升被删项、
 * 同步物化保留寄存器原值，稀疏与并列因此都是合法持久状态，只校验非负安全整数、标识唯一
 * 与所属文件夹存在，不要求连续、不重编号。扁平文件夹时代（≤11）沿用当时连续且不重复的
 * 合同，不无据弱化旧格式。
 */
export function validateBackupShortcuts(value: unknown, folders: readonly Folder[],
  formatVersion: SupportedBackupVersion = CURRENT_BACKUP_VERSION): Shortcut[] {
  if (!Array.isArray(value) || value.length > LIMITS.shortcuts) fail('网站数量不符合限制');
  const legacy = formatVersion <= LEGACY_FLAT_FOLDER_BACKUP_VERSION;
  const folderIds = new Set(folders.map(({ id }) => id));
  const ids = new Set<string>();
  const orders = new Map<string, Set<number>>();
  const shortcuts = value.map((item) => validateShortcut({ value: item, folderIds, ids, orders, legacy }));
  if (!legacy) return shortcuts;
  for (const containerOrders of orders.values()) {
    if ([...containerOrders].some((order, index) => order !== index)) fail('网站顺序必须连续');
  }
  return shortcuts;
}

function validateMotionKind(mime: MediaAsset['mime'], kind: MediaAsset['kind'], motion: Record<string, unknown>): void {
  if (kind !== 'background' || (motion.kind !== 'video' && motion.kind !== 'animation')) fail('动态媒体类型不正确');
  if (motion.kind === 'video' && mime !== 'video/mp4' && mime !== 'video/webm') fail('视频 MIME 与媒体信息不一致');
  if (motion.kind === 'animation' && mime !== 'image/gif' && mime !== 'image/webp') fail('动图 MIME 与媒体信息不一致');
}

function motionDuration(kind: MediaAssetMotion['kind'], value: unknown): number | null {
  if (kind === 'animation') {
    if (value !== null) fail('动图不保存视频时长');
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('视频时长不正确');
  return value;
}

function validateMotion(value: unknown, mime: MediaAsset['mime'], kind: MediaAsset['kind']): BackupAsset['motion'] {
  if (value === null) return null;
  const raw = record(value, '动态媒体信息');
  exactKeys(raw, ['kind', 'duration'], '动态媒体信息');
  validateMotionKind(mime, kind, raw);
  const motionKind = raw.kind as MediaAssetMotion['kind'];
  return { kind: motionKind, duration: motionDuration(motionKind, raw.duration) };
}

function validateAssetType(kind: unknown, mime: unknown): { kind: MediaAsset['kind']; mime: MediaAsset['mime'] } {
  if (kind !== 'icon' && kind !== 'background') fail('媒体资源类型不正确');
  const supportedMime = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm'];
  if (typeof mime !== 'string' || !supportedMime.includes(mime)) fail('媒体资源格式不正确');
  if (kind === 'icon' && mime !== 'image/png' && mime !== 'image/svg+xml') fail('网站图标必须是 PNG 或 SVG');
  if (kind === 'background' && mime === 'image/svg+xml') fail('SVG 不能作为背景图片');
  return { kind, mime: mime as MediaAsset['mime'] };
}

function validateAssetDimensions(input: { readonly width: unknown; readonly height: unknown; readonly kind: MediaAsset['kind']; readonly motion: BackupAsset['motion'] }): { width: number; height: number } {
  const { width, height, kind, motion } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Number(width) <= 0 || Number(height) <= 0) fail('媒体尺寸不正确');
  if (!motion) {
    imageOutputSize({ width: Number(width), height: Number(height), kind });
    const edgeLimit = kind === 'icon' ? 1024 : 2560;
    if (Math.max(Number(width), Number(height)) > edgeLimit) fail('图片最长边超出限制');
  }
  return { width: Number(width), height: Number(height) };
}

function validateAssetName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail('媒体名称格式不正确');
  const name = normalizeOptionalAssetName(value);
  if (name === '' || name !== value) fail('媒体名称必须是已保存的规范格式');
  return name;
}

function validateAsset(value: unknown, formatVersion: SupportedBackupVersion): BackupAsset {
  const raw = record(value, '媒体资源');
  const hasName = formatVersion >= 8;
  exactKeys(raw, hasName
    ? ['id', 'kind', 'mime', 'width', 'height', 'sourceUrl', 'name', 'motion', 'byteLength', 'sha256']
    : ['id', 'kind', 'mime', 'width', 'height', 'sourceUrl', 'motion', 'byteLength', 'sha256'], '媒体资源');
  const { kind, mime } = validateAssetType(raw.kind, raw.mime);
  const motion = validateMotion(raw.motion, mime, kind);
  validateMotionPresence(mime, motion);
  const { width, height } = validateAssetDimensions({ width: raw.width, height: raw.height, kind, motion });
  if (!Number.isSafeInteger(raw.byteLength) || Number(raw.byteLength) <= 0) fail('媒体大小不正确');
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) fail('媒体摘要格式不正确');
  const id = textField(raw.id, '媒体标识');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail('媒体标识不能用于规范 ZIP 路径');
  const sourceUrl = validateSourceUrl(raw.sourceUrl, '媒体来源地址');
  if (motion && sourceUrl !== null) fail('动态媒体只支持本地来源');
  return { id, kind, mime, width, height, sourceUrl, name: hasName ? validateAssetName(raw.name) : null,
    motion, byteLength: Number(raw.byteLength), sha256: raw.sha256 };
}

function validateMotionPresence(mime: MediaAsset['mime'], motion: BackupAsset['motion']): void {
  const requiresMotion = mime === 'image/gif' || mime === 'video/mp4' || mime === 'video/webm';
  if (requiresMotion && !motion) fail('动态媒体缺少动态类型信息');
}

export function validateBackupAssets(value: unknown, formatVersion: SupportedBackupVersion = CURRENT_BACKUP_VERSION): BackupAsset[] {
  if (!Array.isArray(value)) fail('媒体资源列表格式不正确');
  return value.map((item) => validateAsset(item, formatVersion));
}

function referencedBackground(background: BackupSettings['appearance']['background'], assets: ReadonlyMap<string, BackupAsset>): string | null {
  if (background.kind !== 'photo' && background.kind !== 'motion') return null;
  const asset = assets.get(background.assetId);
  const motion = background.kind === 'motion';
  if (!asset || asset.kind !== 'background' || Boolean(asset.motion) !== motion) fail('背景媒体引用不存在或类型不匹配');
  return asset.id;
}

function referencedShortcut(shortcut: Shortcut, assets: ReadonlyMap<string, BackupAsset>): string | null {
  if (shortcut.icon.kind !== 'asset') {
    if (shortcut.iconSourceUrl !== null) fail('文字或内置图标不能带图片来源地址');
    return null;
  }
  const asset = assets.get(shortcut.icon.assetId);
  if (!asset || asset.kind !== 'icon') fail('网站图片图标引用不存在');
  if (shortcut.icon.color && asset.mime !== 'image/svg+xml') fail('SVG 图标颜色只能用于 SVG 资源');
  if (shortcut.iconSourceUrl !== asset.sourceUrl) fail('网站图标来源地址不一致');
  return asset.id;
}

export interface BackupReferencesInput {
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: BackupSettings;
  readonly assets: readonly BackupAsset[];
}

export function validateBackupReferences(input: BackupReferencesInput): void {
  const { folders, shortcuts, settings, assets } = input;
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  if (assetMap.size !== assets.length) fail('媒体标识不能重复');
  const references = new Set<string>();
  const background = referencedBackground(settings.appearance.background, assetMap);
  if (background) references.add(background);
  for (const shortcut of shortcuts) {
    const id = referencedShortcut(shortcut, assetMap);
    if (id) references.add(id);
  }
  if (assets.some(({ kind, id }) => kind === 'icon' && !references.has(id))) fail('备份包含未被引用的网站图标');
  const folderIds = new Set(folders.map(({ id }) => id));
  if (shortcuts.some(({ folderId }) => folderId !== null && !folderIds.has(folderId))) fail('网站所属文件夹不存在');
}
