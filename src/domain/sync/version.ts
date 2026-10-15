import type { SyncSnapshotV1 } from '@/domain/sync/types';

/** Reads all observed logical clocks without depending on the wall clock. */
export function maximumSyncClock(snapshot: SyncSnapshotV1): number {
  const clocks = [
    snapshot.defaultGroupId.clock,
    ...snapshot.groups.flatMap((group) => [group.name.clock, group.colorRole.clock, group.position.clock]),
    ...snapshot.shortcuts.flatMap((shortcut) => [
      shortcut.title.clock, shortcut.url.clock, shortcut.placement.clock, shortcut.icon.clock,
    ]),
    snapshot.settings.appearance.clock, snapshot.settings.defaultEngineId.clock,
    snapshot.settings.layout.clock, snapshot.settings.clock.clock,
    snapshot.settings.searchPreferences.clock, snapshot.settings.shortcutPreferences.clock,
    ...snapshot.settings.customEngines.map((engine) => engine.clock),
    ...snapshot.assets.map((asset) => asset.sourceUrl.clock),
    ...snapshot.tombstones.map((tombstone) => tombstone.clock),
  ];
  return clocks.reduce((maximum, clock) => Math.max(maximum, clock), 0);
}

export function nextSyncCounter(counter: number): number {
  if (!Number.isSafeInteger(counter) || counter < 0 || counter === Number.MAX_SAFE_INTEGER) {
    throw new Error('同步逻辑版本不能继续递增');
  }
  return counter + 1;
}
