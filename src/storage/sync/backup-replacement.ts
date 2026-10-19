import type { MediaAsset } from '@/domain/asset';
import type { BackupDocument } from '@/domain/backup';
import type { AppearanceSettings } from '@/domain/appearance';
import type { Database } from '@/storage/db';

interface ReplacementData {
  readonly document: BackupDocument;
  readonly assets: readonly MediaAsset[];
}

function replacementIds(input: {
  readonly ids: readonly string[];
  readonly kind: string;
  readonly known: ReadonlySet<string>;
  readonly createId: () => string;
}): ReadonlyMap<string, string> {
  return new Map(input.ids.filter((id) => input.known.has(`${input.kind}:${id}`))
    .map((id) => [id, input.createId()]));
}

function remapAppearance(appearance: AppearanceSettings, assets: ReadonlyMap<string, string>): AppearanceSettings {
  const background = appearance.background;
  if (background.kind !== 'photo' && background.kind !== 'motion') return appearance;
  return { ...appearance, background: { ...background, assetId: assets.get(background.assetId) ?? background.assetId } };
}

/** A full replacement is new user data; IDs already known to this vault must not resurrect tombstones. */
export async function prepareSyncReplacement(db: Database, input: ReplacementData,
  dependencies: { readonly createId: () => string }): Promise<ReplacementData> {
  if (!await db.sync_state.get('app')) return input;
  const known = new Set((await db.sync_records.toArray()).map(({ id }) => id));
  const maps = {
    folders: replacementIds({ ids: input.document.folders.map(({ id }) => id), kind: 'folder', known, ...dependencies }),
    shortcuts: replacementIds({ ids: input.document.shortcuts.map(({ id }) => id), kind: 'shortcut', known, ...dependencies }),
    assets: replacementIds({ ids: input.assets.map(({ id }) => id), kind: 'asset', known, ...dependencies }),
    engines: replacementIds({ ids: input.document.settings.search.customEngines.map(({ id }) => id),
      kind: 'custom-engine', known, ...dependencies }),
  };
  const settings = input.document.settings;
  const document: BackupDocument = {
    ...input.document,
    folders: input.document.folders.map((folder) => ({ ...folder, id: maps.folders.get(folder.id) ?? folder.id })),
    shortcuts: input.document.shortcuts.map((shortcut) => ({
      ...shortcut, id: maps.shortcuts.get(shortcut.id) ?? shortcut.id,
      folderId: shortcut.folderId === null ? null : maps.folders.get(shortcut.folderId) ?? shortcut.folderId,
      icon: shortcut.icon.kind === 'asset'
        ? { ...shortcut.icon, assetId: maps.assets.get(shortcut.icon.assetId) ?? shortcut.icon.assetId } : shortcut.icon,
    })),
    assets: input.document.assets.map((asset) => ({ ...asset, id: maps.assets.get(asset.id) ?? asset.id })),
    settings: { ...settings, appearance: remapAppearance(settings.appearance, maps.assets),
      search: { ...settings.search,
        defaultEngineId: maps.engines.get(settings.search.defaultEngineId) ?? settings.search.defaultEngineId,
        customEngines: settings.search.customEngines.map((engine) => ({ ...engine, id: maps.engines.get(engine.id) ?? engine.id })),
        customization: { ...settings.search.customization, engineKeywords: Object.fromEntries(
          Object.entries(settings.search.customization.engineKeywords).map(([id, keyword]) => [maps.engines.get(id) ?? id, keyword])) } } },
  };
  return { document, assets: input.assets.map((asset) => ({ ...asset, id: maps.assets.get(asset.id) ?? asset.id })) };
}
