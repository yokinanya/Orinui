import { fail } from '@/domain/errors';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import type { AppSettings } from '@/domain/settings';
import { CURRENT_BACKUP_VERSION, LEGACY_BACKUP_VERSION, PREVIOUS_BACKUP_VERSION, validateBackupSettings } from '@/domain/backup-settings';
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

export interface BackupDocument {
  readonly formatVersion: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
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

export function parseBackup(value: unknown): BackupPreview {
  const raw = record(value);
  exactManifest(raw);
  const formatVersion = raw.formatVersion;
  if (formatVersion !== CURRENT_BACKUP_VERSION && formatVersion !== PREVIOUS_BACKUP_VERSION && formatVersion !== LEGACY_BACKUP_VERSION) {
    fail('备份版本不兼容当前文件夹协议；请使用文件夹版本 ZIP 备份');
  }
  if (typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt))) fail('备份时间不正确');
  const folders = validateBackupFolders(raw.folders);
  const shortcuts = validateBackupShortcuts(raw.shortcuts, folders);
  const settings = validateBackupSettings(raw.settings, formatVersion);
  const assets = validateBackupAssets(raw.assets, formatVersion);
  validateBackupReferences({ folders, shortcuts, settings, assets });
  const engine = resolveEngine(settings.search.defaultEngineId, settings.search.customEngines,
    settings.search.customization.engineOverrides);
  if (!engine) fail('默认搜索引擎不存在');
  return { folderCount: folders.length, shortcutCount: shortcuts.length, assetCount: assets.length,
    backgroundCount: assets.filter(({ kind }) => kind === 'background').length,
    totalAssetBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
    engine: engine.name,
    document: { formatVersion: BACKUP_VERSION, exportedAt: raw.exportedAt, folders, shortcuts, settings, assets } };
}

export function validateCustomEngine(input: { readonly name: string; readonly template: string }): Pick<SearchEngine, 'name' | 'template'> {
  return { name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) };
}
