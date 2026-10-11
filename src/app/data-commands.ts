import type { DataContextValue } from '@/app/data-context';
import { getImageAsset, pruneUnreferencedAssets } from '@/storage/assets';
import type { Database } from '@/storage/db';
import * as groups from '@/storage/groups';
import { setPhotoBackground } from '@/storage/image-operations';
import { clearImageSourceUrl } from '@/storage/source-metadata';
import { readSettings, updateSettings } from '@/storage/settings';
import * as shortcuts from '@/storage/shortcuts';
import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { ClockFormat } from '@/domain/settings';
import { newId } from '@/domain/id';
import { validateEngineTemplate } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import type { GroupColorRole } from '@/domain/group';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { serializeBackup } from '@/platform/backup-file';
import type { RestorableBackup } from '@/platform/backup-file';

interface CommandDependencies {
  readonly db: Database;
  readonly activeGroupId: string | null;
  readonly loadGroups: () => Promise<Group[]>;
  readonly loadShortcuts: (groupId: string | null) => Promise<void>;
  readonly setActiveGroupId: (id: string | null) => void;
  readonly setSettings: (settings: AppSettings) => void;
}

type ShortcutCommands = Pick<DataContextValue, 'createShortcut' | 'updateShortcut' | 'deleteShortcut' | 'restoreShortcut' | 'moveShortcut' | 'reorderShortcut' | 'moveShortcutToGroup' | 'countShortcutsInGroup'>;

function shortcutCommands({ db, activeGroupId, loadShortcuts }: CommandDependencies): ShortcutCommands {
  return {
    async createShortcut(input) {
      await shortcuts.createShortcut(db, input);
      await loadShortcuts(activeGroupId);
    },
    async updateShortcut(id, patch) {
      await shortcuts.updateShortcut(db, id, patch);
      await loadShortcuts(activeGroupId);
    },
    async deleteShortcut(id) {
      const removed = await shortcuts.deleteShortcut(db, id);
      await loadShortcuts(activeGroupId);
      return removed;
    },
    async restoreShortcut(shortcut) {
      await shortcuts.restoreShortcut(db, shortcut);
      await loadShortcuts(activeGroupId);
    },
    async moveShortcut(id, direction) {
      await shortcuts.moveShortcut(db, id, direction);
      await loadShortcuts(activeGroupId);
    },
    async reorderShortcut(id, index) {
      await shortcuts.reorderShortcut(db, id, index);
      await loadShortcuts(activeGroupId);
    },
    async moveShortcutToGroup(id, groupId) {
      await shortcuts.moveShortcutToGroup(db, id, groupId);
      await loadShortcuts(activeGroupId);
    },
    countShortcutsInGroup: (groupId) => shortcuts.countShortcutsInGroup(db, groupId),
  };
}

type GroupCommands = Pick<DataContextValue, 'createGroup' | 'renameGroup' | 'deleteGroup' | 'moveGroup' | 'reorderGroup'>;

function groupCommands({ db, activeGroupId, loadGroups, setActiveGroupId }: CommandDependencies): GroupCommands {
  return {
    async createGroup(name) {
      const created = await groups.createGroup(db, name);
      await loadGroups();
      setActiveGroupId(created.id);
    },
    async renameGroup(id, name) {
      await groups.renameGroup(db, id, name);
      await loadGroups();
    },
    async deleteGroup(id) {
      await groups.deleteGroup(db, id);
      const remaining = await loadGroups();
      if (activeGroupId !== id) return;
      const defaultGroup = remaining.find((group) => group.isDefault);
      if (!defaultGroup) throw new Error('分组数据缺少默认分组');
      setActiveGroupId(defaultGroup.id);
    },
    async moveGroup(id, direction) {
      await groups.moveGroup(db, id, direction);
      await loadGroups();
    },
    async reorderGroup(id, index) {
      await groups.reorderGroup(db, id, index);
      await loadGroups();
    },
  };
}

type AppearanceCommands = Pick<DataContextValue, 'updateAppearance' | 'updateLayout' | 'updateClockFormat' | 'setPhotoBackground' | 'clearImageSourceUrl'>;

function appearanceCommands({ db, setSettings, loadShortcuts, activeGroupId }: CommandDependencies): AppearanceCommands {
  return {
    async updateAppearance(patch) {
      await db.transaction('rw', db.settings, db.assets, db.shortcuts, async () => {
        await updateSettings(db, (current) => ({
          ...current, appearance: { ...current.appearance, ...patch },
        }));
        await pruneUnreferencedAssets(db);
      });
      setSettings(await readSettings(db));
    },
    async updateLayout(layout) {
      setSettings(await updateSettings(db, (current) => ({ ...current, layout })));
    },
    async updateClockFormat(format: ClockFormat) {
      setSettings(await updateSettings(db, (current) => ({ ...current, clock: { format } })));
    },
    async setPhotoBackground(image) {
      await setPhotoBackground(db, image);
      setSettings(await readSettings(db));
    },
    async clearImageSourceUrl(assetId) {
      await clearImageSourceUrl(db, assetId);
      await loadShortcuts(activeGroupId);
    },
  };
}

type SearchCommands = Pick<DataContextValue, 'setDefaultEngine' | 'createSearchEngine' | 'updateSearchEngine' | 'deleteSearchEngine'>;

function searchCommands({ db, setSettings }: CommandDependencies): SearchCommands {
  return {
    async setDefaultEngine(id) {
      setSettings(await updateSettings(db, (current) => ({ ...current, search: { ...current.search, defaultEngineId: id } })));
    },
    async createSearchEngine(input) {
      await updateSettings(db, (current) => ({ ...current, search: {
        ...current.search,
        customEngines: [...current.search.customEngines, { id: newId(), builtIn: false, name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) }],
      } }));
      setSettings(await readSettings(db));
    },
    async updateSearchEngine(id, input) {
      setSettings(await updateSettings(db, (current) => {
        if (!current.search.customEngines.some((engine) => engine.id === id)) throw new Error('自定义搜索引擎不存在');
        return { ...current, search: { ...current.search, customEngines: current.search.customEngines.map((engine) => engine.id === id
          ? { ...engine, name: normalizeEngineName(input.name), template: validateEngineTemplate(input.template) } : engine) } };
      }));
    },
    async deleteSearchEngine(id) {
      await updateSettings(db, (current) => {
        if (current.search.defaultEngineId === id) throw new Error('请先切换默认搜索引擎，再删除此项');
        if (!current.search.customEngines.some((engine) => engine.id === id)) throw new Error('自定义搜索引擎不存在');
        return { ...current, search: { ...current.search, customEngines: current.search.customEngines.filter((engine) => engine.id !== id) } };
      });
      setSettings(await readSettings(db));
    },
  };
}

type ColorCommands = Pick<DataContextValue, 'updateGroupColor'>;

function colorCommands({ db, loadGroups }: CommandDependencies): ColorCommands {
  return {
    async updateGroupColor(id, colorRole) {
      await groups.updateGroupColor(db, id, colorRole);
      await loadGroups();
    },
  };
}

type BackupCommands = Pick<DataContextValue, 'exportBackup' | 'restoreBackup' | 'resetLocalData'>;

function backupCommands({ db, setSettings, setActiveGroupId, loadGroups, loadShortcuts }: CommandDependencies): BackupCommands {
  const activateDefaultGroup = async () => {
    const remaining = await loadGroups();
    const primary = remaining.find((group) => group.isDefault);
    if (!primary) throw new Error('数据中缺少默认分组');
    setActiveGroupId(primary.id);
    await loadShortcuts(primary.id);
    setSettings(await readSettings(db));
  };
  return {
    async exportBackup() {
      return serializeBackup(await createBackupSnapshot(db));
    },
    async restoreBackup(backup: RestorableBackup) {
      await replaceAllData(db, { document: backup.document, assets: backup.images });
      await activateDefaultGroup();
    },
    async resetLocalData() {
      await resetLocalData(db);
      await activateDefaultGroup();
    },
  };
}

/** 绑定由数据桥注入的数据库与刷新方法，不持有全局数据库。 */
export function createDataCommands(dependencies: CommandDependencies) {
  return { ...shortcutCommands(dependencies), ...groupCommands(dependencies), ...appearanceCommands(dependencies),
    ...searchCommands(dependencies), ...colorCommands(dependencies), ...backupCommands(dependencies) };
}

export function imageReader(db: Database) {
  return async (id: string) => {
    const asset = await getImageAsset(db, id);
    if (!asset) throw new Error('本地图片资源不存在');
    return asset;
  };
}
