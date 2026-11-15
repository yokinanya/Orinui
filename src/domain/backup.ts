import { fail } from '@/domain/errors';
import { LEGACY_HOME_BACKUP_VERSION, LEGACY_FLAT_FOLDER_BACKUP_VERSION, toPortableSettings, validateBackupSettings,
  type BackupSettings } from '@/domain/backup-settings';
import { EMPTY_HOME, reconcileHome, assertHomeDisjoint } from '@/domain/home';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import type { AppSettings } from '@/domain/settings';
import { CURRENT_BACKUP_VERSION, LEGACY_BACKUP_VERSION, PREVIOUS_BACKUP_VERSION, type SupportedBackupVersion } from '@/domain/backup-settings';
import type { MediaAsset, MediaAssetMotion } from '@/domain/asset';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { validateBackupAssets, validateBackupFolders, validateBackupReferences, validateBackupShortcuts } from '@/domain/backup-assets';

export const BACKUP_VERSION = CURRENT_BACKUP_VERSION;

export interface BackupAsset {
  readonly id: string;
  readonly kind: MediaAsset['kind'];
  readonly mime: MediaAsset['mime'];
  readonly width: number;
  readonly height: number;
  readonly sourceUrl: string | null;
  /** 素材库显示名；格式版本 5 及更早没有该字段。 */
  readonly name: string | null;
  readonly motion: Omit<MediaAssetMotion, 'poster'> | null;
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * ZIP 清单：设置里**没有** `bookmarks`。
 *
 * 清单形状与运行时 `AppSettings` 不同，因此导入不会把默认书签偏好当成备份内容，
 * 也不会在再解析时因为多出 `bookmarks` 键而失败。
 */
export interface BackupDocument {
  readonly formatVersion: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: BackupSettings;
  readonly assets: readonly BackupAsset[];
}

export interface BackupPreview {
  readonly folderCount: number;
  readonly shortcutCount: number;
  readonly assetCount: number;
  readonly backgroundCount: number;
  readonly totalAssetBytes: number;
  readonly engine: string;
  readonly document: BackupDocument;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('备份清单格式不正确');
  return value as Record<string, unknown>;
}

function exactManifest(raw: Record<string, unknown>): void {
  const keys = ['formatVersion', 'exportedAt', 'folders', 'shortcuts', 'settings', 'assets'];
  if (Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) fail('备份清单字段不正确');
}

function supportedVersion(value: unknown): value is SupportedBackupVersion {
  return value === CURRENT_BACKUP_VERSION || value === LEGACY_FLAT_FOLDER_BACKUP_VERSION
    || value === LEGACY_HOME_BACKUP_VERSION || value === PREVIOUS_BACKUP_VERSION || value === LEGACY_BACKUP_VERSION;
}

export function parseBackup(value: unknown): BackupPreview {
  const raw = record(value);
  exactManifest(raw);
  const formatVersion = raw.formatVersion;
  if (!supportedVersion(formatVersion)) {
    fail('备份版本不兼容当前文件夹协议；请使用文件夹版本 ZIP 备份');
  }
  if (typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt))) fail('备份时间不正确');
  const folders = validateBackupFolders(raw.folders, formatVersion);
  const shortcuts = validateBackupShortcuts(raw.shortcuts, folders, formatVersion);
  const parsedSettings = validateBackupSettings(raw.settings, formatVersion);
  // 只让顶层文件夹参与主页格位；嵌套文件夹不占格位。
  const home = reconcileHome({ home: parsedSettings.home ?? EMPTY_HOME, folders, shortcuts });
  if (formatVersion >= LEGACY_FLAT_FOLDER_BACKUP_VERSION && parsedSettings.home?.placements.some(({ id }) => !home.placements.some((item) => item.id === id))) fail('备份格位引用不存在');
  if (formatVersion >= LEGACY_FLAT_FOLDER_BACKUP_VERSION && parsedSettings.home?.widgets.some(({ id }) => !parsedSettings.home?.placements.some((item) => item.id === `widget:${id}`))) fail('备份小组件格位缺失');
  assertHomeDisjoint(home.placements);
  const portable = { ...parsedSettings, home };
  const assets = validateBackupAssets(raw.assets, formatVersion);
  validateBackupReferences({ folders, shortcuts, settings: portable, assets });
  const engine = resolveEngine(portable.search.defaultEngineId, portable.search.customEngines,
    portable.search.customization.engineOverrides);
  if (!engine) fail('默认搜索引擎不存在');
  return { folderCount: folders.length, shortcutCount: shortcuts.length, assetCount: assets.length,
    backgroundCount: assets.filter(({ kind }) => kind === 'background').length,
    totalAssetBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
    engine: engine.name,
    document: { formatVersion: BACKUP_VERSION, exportedAt: raw.exportedAt, folders, shortcuts, settings: portable, assets } };
}

/** 备份清单里没有书签偏好；运行时设置由调用方补回本机现状。 */
export function backupDocument(input: { readonly settings: AppSettings; readonly exportedAt: string;
  readonly folders: readonly Folder[]; readonly shortcuts: readonly Shortcut[]; readonly assets: readonly BackupAsset[] }): BackupDocument {
  return { formatVersion: BACKUP_VERSION, exportedAt: input.exportedAt, folders: input.folders,
    shortcuts: input.shortcuts, settings: toPortableSettings(input.settings), assets: input.assets };
}

export function validateCustomEngine(input: { readonly name: string; readonly template: string }): Pick<SearchEngine, 'name' | 'template'> {
  return { name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) };
}
