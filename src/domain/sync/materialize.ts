import { fail } from '@/domain/errors';
import type { Group } from '@/domain/group';
import type { MediaAsset } from '@/domain/asset';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncRegister, SyncSnapshotV1 } from '@/domain/sync/types';
import { parseSyncSnapshot } from '@/domain/sync/validate';

export interface MaterializedSyncData {
  readonly groups: readonly Group[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly Omit<MediaAsset, 'blob'>[];
  readonly defaultGroupId: string;
}

interface OrderBy<T> {
  readonly position: (item: T) => number;
  readonly version: (item: T) => SyncRegister<unknown>;
  readonly id: (item: T) => string;
}

function ordered<T>(items: readonly T[], by: OrderBy<T>): T[] {
  return [...items].sort((left, right) => by.position(left) - by.position(right) ||
    by.version(right).clock - by.version(left).clock || compareText(by.version(right).deviceId, by.version(left).deviceId) || compareText(by.id(left), by.id(right)));
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function materializeSyncSnapshot(input: SyncSnapshotV1): MaterializedSyncData {
  const snapshot = parseSyncSnapshot(input);
  const defaultGroupId = snapshot.defaultGroupId.value;
  const groups = ordered(snapshot.groups, { position: ({ position }) => position.value, version: ({ position }) => position, id: ({ id }) => id })
    .map((group, order) => ({ id: group.id, name: group.name.value, colorRole: group.id === defaultGroupId ? 'primary' : group.colorRole.value,
      order, isDefault: group.id === defaultGroupId } satisfies Group));
  if (groups.filter(({ isDefault }) => isDefault).length !== 1) fail('合并结果必须恰好包含一个默认分组');
  const nextOrderByGroup = new Map<string, number>();
  const shortcuts: Shortcut[] = [];
  for (const shortcut of ordered(snapshot.shortcuts, {
    position: ({ placement }) => placement.value.order, version: ({ placement }) => placement, id: ({ id }) => id,
  })) {
    const placement = shortcut.placement.value;
    const order = nextOrderByGroup.get(placement.groupId) ?? 0;
    nextOrderByGroup.set(placement.groupId, order + 1);
    const icon = shortcut.icon.value;
    const asset = icon.kind === 'asset' ? snapshot.assets.find(({ id }) => id === icon.assetId) : undefined;
    if (icon.kind === 'asset' && !asset) fail(`网站图标资源不存在：${icon.assetId}`);
    shortcuts.push({ id: shortcut.id, groupId: placement.groupId, order, title: shortcut.title.value, url: shortcut.url.value,
      icon, iconSourceUrl: asset?.sourceUrl.value ?? null });
  }
  const settings: AppSettings = {
    appearance: snapshot.settings.appearance.value,
    search: { defaultEngineId: snapshot.settings.defaultEngineId.value,
      customEngines: snapshot.settings.customEngines.map(({ value }) => value),
      ...snapshot.settings.searchPreferences.value },
    shortcuts: snapshot.settings.shortcutPreferences.value,
    layout: snapshot.settings.layout.value, clock: snapshot.settings.clock.value,
  };
  const assets = snapshot.assets.map(({ id, kind, mime, width, height, sourceUrl, motion }) => ({ id, kind, mime, width, height,
    sourceUrl: sourceUrl.value, ...(motion ? { motion } : {}) }));
  return { groups, shortcuts, settings, assets, defaultGroupId };
}
