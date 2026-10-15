import { createDefaultSettings } from '@/domain/settings';
import {
  materializeSyncSnapshot, mergeSyncSnapshots, parseSyncSnapshot,
  type SyncRegister, type SyncSnapshotV1,
} from '@/domain/sync';
import { maximumSyncClock, nextSyncCounter } from '@/domain/sync/version';
import { DEFAULT_GROUP_NAME } from '@/storage/groups';

function isPristine(snapshot: SyncSnapshotV1): boolean {
  const data = materializeSyncSnapshot(snapshot);
  const group = data.groups[0];
  return data.groups.length === 1 && group?.name === DEFAULT_GROUP_NAME
    && group.colorRole === 'primary' && data.shortcuts.length === 0 && data.assets.length === 0
    && snapshot.tombstones.length === 0
    && JSON.stringify(data.settings) === JSON.stringify(createDefaultSettings());
}

function remoteBaseline(remotes: readonly SyncSnapshotV1[]): SyncSnapshotV1 {
  const first = remotes[0];
  if (!first) throw new Error('已有同步库没有可连接的快照');
  return remotes.reduce((latest, next) => {
    const left = latest.defaultGroupId;
    const right = next.defaultGroupId;
    if (right.clock !== left.clock) return right.clock > left.clock ? next : latest;
    return right.deviceId > left.deviceId ? next : latest;
  }, first);
}

function promoteLocal(input: {
  readonly local: SyncSnapshotV1;
  readonly remote: SyncSnapshotV1;
  readonly clock: number;
}): SyncSnapshotV1 {
  const { local, remote, clock } = input;
  const register = <T>(item: SyncRegister<T>): SyncRegister<T> => ({
    value: item.value, clock, deviceId: local.deviceId,
  });
  const primary = remote.groups.find(({ id }) => id === remote.defaultGroupId.value);
  if (!primary) throw new Error('已有同步库缺少默认分组');
  const groups = local.groups.map((group) => ({
    id: group.id, name: register(group.name), colorRole: register(group.colorRole), position: register(group.position),
  }));
  return parseSyncSnapshot({
    ...local, generation: nextSyncCounter(local.generation), defaultGroupId: remote.defaultGroupId,
    groups: groups.some(({ id }) => id === primary.id) ? groups : [...groups, primary],
    shortcuts: local.shortcuts.map((shortcut) => ({
      id: shortcut.id, title: register(shortcut.title), url: register(shortcut.url),
      placement: register(shortcut.placement), icon: register(shortcut.icon),
    })),
    assets: local.assets.map((asset) => ({ ...asset, sourceUrl: register(asset.sourceUrl) })),
    settings: {
      appearance: register(local.settings.appearance), defaultEngineId: register(local.settings.defaultEngineId),
      layout: register(local.settings.layout), clock: register(local.settings.clock),
      searchPreferences: register(local.settings.searchPreferences),
      shortcutPreferences: register(local.settings.shortcutPreferences),
      customEngines: local.settings.customEngines.map(register),
    },
  });
}

/** Plans the first merge; changing domain data requires a separate validated transaction. */
export function planSyncJoin(input: {
  readonly local: SyncSnapshotV1;
  readonly remotes: readonly SyncSnapshotV1[];
}): SyncSnapshotV1 {
  const local = parseSyncSnapshot(input.local);
  const remotes = input.remotes.map(parseSyncSnapshot);
  if (remotes.some((remote) => remote.vaultId !== local.vaultId || remote.deviceId === local.deviceId)) {
    throw new Error('首次连接需要相同同步库和独立的设备身份');
  }
  const baseline = remoteBaseline(remotes);
  const clock = nextSyncCounter(remotes.reduce((value, snapshot) =>
    Math.max(value, maximumSyncClock(snapshot)), maximumSyncClock(local)));
  const prepared = isPristine(local)
    ? { ...baseline, deviceId: local.deviceId, generation: local.generation }
    : promoteLocal({ local, remote: baseline, clock });
  const joined = mergeSyncSnapshots({ local: prepared, remotes });
  if (sameContent(local, joined) || joined.generation > local.generation) return joined;
  return parseSyncSnapshot({ ...joined, generation: nextSyncCounter(local.generation) });
}

function sameContent(left: SyncSnapshotV1, right: SyncSnapshotV1): boolean {
  const { generation: _leftGeneration, ...leftContent } = left;
  const { generation: _rightGeneration, ...rightContent } = right;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}
