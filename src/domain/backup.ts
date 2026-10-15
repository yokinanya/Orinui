import { fail } from '@/domain/errors';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import type { AppSettings } from '@/domain/settings';
import { validateBackupSettings } from '@/domain/backup-settings';
import type { MediaAsset, MediaAssetMotion } from '@/domain/asset';
import type { Group } from '@/domain/group';
import type { Shortcut } from '@/domain/shortcut';
import { validateBackupAssets, validateBackupGroups, validateBackupReferences, validateBackupShortcuts } from '@/domain/backup-assets';

export const BACKUP_VERSION = 1;

export interface BackupAsset {
  readonly id: string;
  readonly kind: MediaAsset['kind'];
  readonly mime: MediaAsset['mime'];
  readonly width: number;
  readonly height: number;
  readonly sourceUrl: string | null;
  readonly motion: Omit<MediaAssetMotion, 'poster'> | null;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface BackupDocument {
  readonly formatVersion: typeof BACKUP_VERSION;
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

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('备份清单格式不正确');
  return value as Record<string, unknown>;
}

function exactManifest(raw: Record<string, unknown>): void {
  const keys = ['formatVersion', 'exportedAt', 'groups', 'shortcuts', 'settings', 'assets'];
  if (Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) fail('备份清单字段不正确');
}

export function parseBackup(value: unknown): BackupPreview {
  const raw = record(value);
  exactManifest(raw);
  if (raw.formatVersion !== BACKUP_VERSION) fail('备份版本不受支持');
  if (typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt))) fail('备份时间不正确');
  const groups = validateBackupGroups(raw.groups);
  const shortcuts = validateBackupShortcuts(raw.shortcuts, groups);
  const settings = validateBackupSettings(raw.settings);
  const assets = validateBackupAssets(raw.assets);
  validateBackupReferences({ groups, shortcuts, settings, assets });
  const engine = resolveEngine(settings.search.defaultEngineId, settings.search.customEngines);
  if (!engine) fail('默认搜索引擎不存在');
  return { groupCount: groups.length, shortcutCount: shortcuts.length, assetCount: assets.length,
    defaultGroup: groups.find((group) => group.isDefault)?.name ?? '', engine: engine.name,
    document: { formatVersion: BACKUP_VERSION, exportedAt: raw.exportedAt, groups, shortcuts, settings, assets } };
}

export function validateCustomEngine(input: { readonly name: string; readonly template: string }): Pick<SearchEngine, 'name' | 'template'> {
  return { name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) };
}
