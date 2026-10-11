import type { ImageAsset } from '@/domain/asset';
import type { BackupDocument } from '@/domain/backup';
import type { AppearanceSettings } from '@/domain/appearance';
import type { Database } from '@/storage/db';

interface ReplacementData {
  readonly document: BackupDocument;
  readonly assets: readonly ImageAsset[];
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
  if (background.kind !== 'photo') return appearance;
  return { ...appearance, background: { ...background, assetId: assets.get(background.assetId) ?? background.assetId } };
}

/** A full replacement is new user data; IDs already known to this vault must not resurrect tombstones. */
export async function prepareSyncReplacement(db: Database, input: ReplacementData,
  dependencies: { readonly createId: () => string }): Promise<ReplacementData> {
  if (!await db.sync_state.get('app')) return input;
  const known = new Set((await db.sync_records.toArray()).map(({ id }) => id));
  const maps = {
    groups: replacementIds({ ids: input.document.groups.map(({ id }) => id), kind: 'group', known, ...dependencies }),
    shortcuts: replacementIds({ ids: input.document.shortcuts.map(({ id }) => id), kind: 'shortcut', known, ...dependencies }),
    assets: replacementIds({ ids: input.assets.map(({ id }) => id), kind: 'asset', known, ...dependencies }),
    engines: replacementIds({ ids: input.document.settings.search.customEngines.map(({ id }) => id),
      kind: 'custom-engine', known, ...dependencies }),
  };
  const settings = input.document.settings;
  const document: BackupDocument = {
    ...input.document,
    groups: input.document.groups.map((group) => ({ ...group, id: maps.groups.get(group.id) ?? group.id })),
    shortcuts: input.document.shortcuts.map((shortcut) => ({
      ...shortcut, id: maps.shortcuts.get(shortcut.id) ?? shortcut.id,
      groupId: maps.groups.get(shortcut.groupId) ?? shortcut.groupId,
      icon: shortcut.icon.kind === 'asset'
        ? { ...shortcut.icon, assetId: maps.assets.get(shortcut.icon.assetId) ?? shortcut.icon.assetId } : shortcut.icon,
    })),
    assets: input.document.assets.map((asset) => ({ ...asset, id: maps.assets.get(asset.id) ?? asset.id })),
    settings: { ...settings, appearance: remapAppearance(settings.appearance, maps.assets),
      search: { defaultEngineId: maps.engines.get(settings.search.defaultEngineId) ?? settings.search.defaultEngineId,
        customEngines: settings.search.customEngines.map((engine) => ({ ...engine, id: maps.engines.get(engine.id) ?? engine.id })) } },
  };
  return { document, assets: input.assets.map((asset) => ({ ...asset, id: maps.assets.get(asset.id) ?? asset.id })) };
}
