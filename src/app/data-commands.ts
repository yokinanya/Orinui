import { createPreferenceCommands } from '@/app/preference-commands';
import type { DataContextValue } from '@/app/data-context';
import { getMediaAsset, listLibraryAssets, reorderBackgroundAsset, moveBackgroundAsset, pruneUnreferencedAssets, renameBackgroundAsset } from '@/storage/assets';
import type { Database } from '@/storage/db';
import * as folders from '@/storage/folders';
import { activateBackgroundAsset, deleteBackgroundAsset, setPhotoBackground, setMotionBackground } from '@/storage/image-operations';
import { clearImageSourceUrl } from '@/storage/source-metadata';
import { readSettings, updateSettings } from '@/storage/settings';
import * as shortcuts from '@/storage/shortcuts';
import type { Folder } from '@/domain/folder';
import type { AppSettings } from '@/domain/settings';
import { newId } from '@/domain/id';
import { resolveEngine, validateEngineTemplate } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { serializeBackup } from '@/platform/backup-file';
import type { RestorableBackup } from '@/platform/backup-file';

interface CommandDependencies {
  readonly db: Database;
  readonly loadFolders: () => Promise<Folder[]>;
  readonly loadShortcuts: () => Promise<void>;
  readonly setSettings: (settings: AppSettings) => void;
}

type ShortcutCommands = Pick<DataContextValue, 'createShortcut' | 'updateShortcut' | 'deleteShortcut' | 'restoreShortcut' | 'moveShortcut' | 'reorderShortcut' | 'moveShortcutToFolder' | 'countShortcutsInFolder' | 'listAllShortcuts'>;

function shortcutCommands({ db, loadShortcuts }: CommandDependencies): ShortcutCommands {
  return {
    async createShortcut(input) {
      await shortcuts.createShortcut(db, input);
      await loadShortcuts();
    },
    async updateShortcut(id, patch) {
      await shortcuts.updateShortcut(db, id, patch);
      await loadShortcuts();
    },
    async deleteShortcut(id) {
      const removed = await shortcuts.deleteShortcut(db, id);
      await loadShortcuts();
      return removed;
    },
    async restoreShortcut(shortcut) {
      await shortcuts.restoreShortcut(db, shortcut);
      await loadShortcuts();
    },
    async moveShortcut(id, direction) {
      await shortcuts.moveShortcut(db, id, direction);
      await loadShortcuts();
    },
    async reorderShortcut(id, index) {
      await shortcuts.reorderShortcut(db, id, index);
      await loadShortcuts();
    },
    async moveShortcutToFolder(id, folderId) {
      await shortcuts.moveShortcutToFolder(db, id, folderId);
      await loadShortcuts();
    },
    countShortcutsInFolder: (folderId) => folders.countShortcutsInFolder(db, folderId),
    listAllShortcuts: () => shortcuts.listAllShortcuts(db),
  };
}

type FolderCommands = Pick<DataContextValue, 'createFolder' | 'renameFolder' | 'deleteFolder' | 'moveFolder' | 'reorderFolder'>;

function folderCommands({ db, loadFolders, loadShortcuts }: CommandDependencies): FolderCommands {
  return {
    async createFolder(name) {
      await folders.createFolder(db, name);
      await loadFolders();
    },
    async renameFolder(id, name) {
      await folders.renameFolder(db, id, name);
      await loadFolders();
    },
    async deleteFolder(id) {
      // 删除文件夹会把其中的网站移回主页网格，两处都要重新读取。
      await folders.deleteFolder(db, id);
      await loadFolders();
      await loadShortcuts();
    },
    async moveFolder(id, direction) {
      await folders.moveFolder(db, id, direction);
      await loadFolders();
    },
    async reorderFolder(id, index) {
      await folders.reorderFolder(db, id, index);
      await loadFolders();
    },
  };
}

type AppearanceCommands = Pick<DataContextValue, 'updateAppearance' | 'setPhotoBackground' | 'setMotionBackground' | 'clearImageSourceUrl'>;
type WallpaperCommands = Pick<DataContextValue, 'activateBackgroundAsset' | 'deleteBackgroundAsset' | 'listBackgroundAssets'
  | 'renameBackgroundAsset' | 'reorderBackgroundAsset' | 'moveBackgroundAsset'>;

function appearanceCommands({ db, setSettings, loadShortcuts }: CommandDependencies): AppearanceCommands {
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
    async setPhotoBackground(image) {
      await setPhotoBackground(db, image);
      setSettings(await readSettings(db));
    },
    async setMotionBackground(media) {
      await setMotionBackground(db, media);
      setSettings(await readSettings(db));
    },
    async clearImageSourceUrl(assetId) {
      await clearImageSourceUrl(db, assetId);
      await loadShortcuts();
    },
  };
}

function wallpaperCommands({ db, setSettings }: CommandDependencies): WallpaperCommands {
  return {
    async activateBackgroundAsset(id) {
      await activateBackgroundAsset(db, id);
      setSettings(await readSettings(db));
    },
    async deleteBackgroundAsset(id) {
      await deleteBackgroundAsset(db, id);
      setSettings(await readSettings(db));
    },
    listBackgroundAssets: () => listLibraryAssets(db),
    async renameBackgroundAsset(id, name) {
      await renameBackgroundAsset(db, id, name);
    },
    async reorderBackgroundAsset(id, targetId) { return reorderBackgroundAsset(db, { id, targetId }); },
    async moveBackgroundAsset(id, direction) {
      return moveBackgroundAsset(db, { id, direction });
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
        const engineKeywords = { ...current.search.customization.engineKeywords };
        delete engineKeywords[id];
        return { ...current, search: { ...current.search,
          customization: { ...current.search.customization, engineKeywords },
          customEngines: current.search.customEngines.filter((engine) => engine.id !== id) } };
      });
      setSettings(await readSettings(db));
    },
  };
}

type BackupCommands = Pick<DataContextValue, 'exportBackup' | 'restoreBackup' | 'resetLocalData'>;

function backupCommands({ db, setSettings, loadFolders, loadShortcuts }: CommandDependencies): BackupCommands {
  const reloadAll = async () => {
    await loadFolders();
    await loadShortcuts();
    setSettings(await readSettings(db));
  };
  return {
    async exportBackup() {
      return serializeBackup(await createBackupSnapshot(db));
    },
    async restoreBackup(backup: RestorableBackup) {
      await replaceAllData(db, { document: backup.document, assets: backup.assets });
      await reloadAll();
    },
    async resetLocalData() {
      await resetLocalData(db);
      await reloadAll();
    },
  };
}

/** 绑定由数据桥注入的数据库与刷新方法，不持有全局数据库。 */
export function createDataCommands(dependencies: CommandDependencies) {
  return { ...createPreferenceCommands(dependencies), ...shortcutCommands(dependencies), ...folderCommands(dependencies), ...appearanceCommands(dependencies),
    ...wallpaperCommands(dependencies), ...searchCommands(dependencies), ...backupCommands(dependencies) };
}

export function imageReader(db: Database) {
  return async (id: string) => {
    const asset = await getMediaAsset(db, id);
    if (!asset) throw new Error('本地图片资源不存在');
    return asset;
  };
}
