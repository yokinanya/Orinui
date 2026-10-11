import { createDefaultSettings } from '@/domain/settings';
import { DEFAULT_GROUP_NAME } from '@/storage/groups';
import { newId } from '@/domain/id';
import { fail } from '@/domain/errors';
import { SETTINGS_ID, type Database } from '@/storage/db';
import type { ImageAsset } from '@/domain/asset';
import type { Group } from '@/domain/group';
import type { Shortcut } from '@/domain/shortcut';
import type { AppSettings } from '@/domain/settings';
import { readSettings } from '@/storage/settings';
import { parseBackup, BACKUP_VERSION, type BackupDocument } from '@/domain/backup';
import { prepareSyncReplacement } from '@/storage/sync/backup-replacement';

export interface BackupSnapshot {
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly groups: readonly Group[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly ImageAsset[];
}

export async function createBackupSnapshot(db: Database): Promise<BackupSnapshot> {
  const state = await db.transaction('r', db.groups, db.shortcuts, db.settings, db.assets, async () => ({
    groups: await db.groups.toArray(),
    shortcuts: await db.shortcuts.toArray(),
    settings: await readSettings(db),
    assets: await db.assets.toArray(),
  }));
  if (!state.groups.some((group) => group.isDefault)) fail('分组数据缺少默认分组');
  const byOrder = <T extends { readonly order: number }>(items: readonly T[]) => [...items].sort((left, right) => left.order - right.order);
  return { version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    groups: byOrder(state.groups), shortcuts: [...state.shortcuts].sort((a, b) => a.groupId.localeCompare(b.groupId) || a.order - b.order),
    settings: state.settings, assets: state.assets };
}

export interface RestoreBackupInput {
  readonly document: BackupDocument;
  readonly assets: readonly ImageAsset[];
}

export async function replaceAllData(db: Database, backup: RestoreBackupInput): Promise<void> {
  const { document, assets } = backup;
  parseBackup(document);
  if (document.assets.length !== assets.length) fail('备份图片记录不完整');
  for (const asset of assets) {
    const source = document.assets.find((item) => item.id === asset.id);
    if (!source || source.kind !== asset.kind || source.mime !== asset.mime || source.width !== asset.width || source.height !== asset.height || source.sourceUrl !== asset.sourceUrl) {
      fail('图片内容与备份记录不一致');
    }
  }
  await db.transaction('rw', [db.groups, db.shortcuts, db.settings, db.assets, db.sync_state, db.sync_records], async () => {
    const replacement = await prepareSyncReplacement(db, backup, { createId: newId });
    parseBackup(replacement.document);
    await db.groups.clear();
    await db.shortcuts.clear();
    await db.settings.clear();
    await db.assets.clear();
    await db.groups.bulkAdd([...replacement.document.groups]);
    await db.shortcuts.bulkAdd([...replacement.document.shortcuts]);
    await db.settings.put({ id: SETTINGS_ID, ...replacement.document.settings });
    await db.assets.bulkAdd([...replacement.assets]);
  });
}

export async function resetLocalData(db: Database): Promise<void> {
  const settings = createDefaultSettings();
  await db.transaction('rw', db.groups, db.shortcuts, db.settings, db.assets, async () => {
    await db.groups.clear();
    await db.shortcuts.clear();
    await db.assets.clear();
    await db.settings.put({ id: SETTINGS_ID, ...settings });
    await db.groups.add({ id: newId(), name: DEFAULT_GROUP_NAME, colorRole: 'primary', order: 0, isDefault: true });
  });
}
