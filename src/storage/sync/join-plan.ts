import { createDefaultSettings } from '@/domain/settings';
import {
  materializeSyncSnapshot, mergeSyncSnapshots, parseSyncSnapshot,
  type SyncRegister, type SyncSnapshot,
} from '@/domain/sync';
import { maximumSyncClock, nextSyncCounter } from '@/domain/sync/version';

/** 本地没有任何用户内容：未建文件夹、没有网站与媒体、设置仍是默认值。 */
function isPristine(snapshot: SyncSnapshot): boolean {
  const data = materializeSyncSnapshot(snapshot);
  return data.folders.length === 0 && data.shortcuts.length === 0 && data.assets.length === 0
    && snapshot.tombstones.length === 0
    && JSON.stringify(data.settings) === JSON.stringify(createDefaultSettings());
}

function remoteBaseline(remotes: readonly SyncSnapshot[]): SyncSnapshot {
  const first = remotes[0];
  if (!first) throw new Error('已有同步库没有可连接的快照');
  return remotes.reduce((latest, next) =>
    (next.generation > latest.generation ? next : latest), first);
}

function promoteLocal(input: {
  readonly local: SyncSnapshot;
  readonly remote: SyncSnapshot;
  readonly clock: number;
}): SyncSnapshot {
  const { local, remote, clock } = input;
  const register = <T>(item: SyncRegister<T>): SyncRegister<T> => ({
    value: item.value, clock, deviceId: local.deviceId,
  });
  return parseSyncSnapshot({
    ...local, generation: nextSyncCounter(local.generation),
    folders: local.folders.map((folder) => ({
      id: folder.id, name: register(folder.name), position: register(folder.position),
    })),
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
    // 远端快照已存在的实体必须一并带上，否则首次连接会丢掉同一同步库里其他设备的内容。
    tombstones: remote.tombstones,
  });
}

/** Plans the first merge; changing domain data requires a separate validated transaction. */
export function planSyncJoin(input: {
  readonly local: SyncSnapshot;
  readonly remotes: readonly SyncSnapshot[];
}): SyncSnapshot {
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

function sameContent(left: SyncSnapshot, right: SyncSnapshot): boolean {
  const { generation: _leftGeneration, ...leftContent } = left;
  const { generation: _rightGeneration, ...rightContent } = right;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}
