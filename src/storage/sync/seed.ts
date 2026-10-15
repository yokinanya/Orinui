import { createDefaultSettings } from '@/domain/settings';
import { fail } from '@/domain/errors';
import type { AppSettings } from '@/domain/settings';
import type { Group } from '@/domain/group';
import type { Shortcut } from '@/domain/shortcut';
import type { MediaAsset } from '@/domain/asset';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow } from '@/storage/sync/types';
import { buildAssetRecord, buildEngineRecord, buildGroupRecord, buildSettingsRecord, buildShortcutRecord,
  recordId, SyncClock } from '@/storage/sync/builders';
import type { Database, SettingsRow } from '@/storage/db';

function addIfChanged(input: { readonly records: Map<string, SyncRecordRow>; readonly previous?: SyncRecordRow;
  readonly next: SyncEntityRecordRow; readonly clock: SyncClock }): Map<string, SyncRecordRow> {
  const { records, previous, next, clock } = input;
  if (previous?.kind === 'tombstone') fail(`同步墓碑标识不能复用：${next.id}`);
  if (JSON.stringify(previous) === JSON.stringify(next)) return records;
  clock.markChanged();
  const updated = new Map(records);
  updated.set(next.id, next);
  return updated;
}

function settingsValue(row: SettingsRow | undefined): AppSettings {
  return row ? { appearance: row.appearance, search: row.search, shortcuts: row.shortcuts,
    layout: row.layout, clock: row.clock } : createDefaultSettings();
}

interface SeedRecordsInput {
  readonly groups: readonly Group[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly MediaAsset[];
  readonly prior: ReadonlyMap<string, SyncRecordRow>;
  readonly clock: SyncClock;
  readonly now: number;
}

function seedEntityRecords(input: SeedRecordsInput): Map<string, SyncRecordRow> {
  const { groups, shortcuts, settings, assets, prior, clock, now } = input;
  let changes = new Map<string, SyncRecordRow>();
  for (const group of groups) {
    const previous = prior.get(recordId('group', group.id));
    changes = addIfChanged({ records: changes, previous, next: buildGroupRecord({ group, previous, clock }), clock });
  }
  for (const shortcut of shortcuts) {
    const previous = prior.get(recordId('shortcut', shortcut.id));
    if (previous?.kind === 'shortcut' && previous.pendingDeleteUntil !== undefined && now >= previous.pendingDeleteUntil) {
      fail(`网站撤销期限已过，不能由同步初始化复活：${shortcut.id}`);
    }
    changes = addIfChanged({ records: changes, previous, next: buildShortcutRecord({ shortcut, previous, clock }), clock });
  }
  return seedSettingsAndAssets({ changes, settings, assets, prior, clock });
}

function seedSettingsAndAssets(input: { readonly changes: Map<string, SyncRecordRow>; readonly settings: AppSettings;
  readonly assets: readonly MediaAsset[]; readonly prior: ReadonlyMap<string, SyncRecordRow>; readonly clock: SyncClock }): Map<string, SyncRecordRow> {
  const { settings, assets, prior, clock } = input;
  let changes = input.changes;
  const previousSettings = prior.get(recordId('settings', 'app'));
  changes = addIfChanged({ records: changes, previous: previousSettings, next: buildSettingsRecord(settings, previousSettings, clock), clock });
  for (const engine of settings.search.customEngines) {
    const previous = prior.get(recordId('custom-engine', engine.id));
    changes = addIfChanged({ records: changes, previous, next: buildEngineRecord(engine, previous, clock), clock });
  }
  for (const asset of assets) {
    const previous = prior.get(recordId('asset', asset.id));
    changes = addIfChanged({ records: changes, previous, next: buildAssetRecord(asset, previous, clock), clock });
  }
  return changes;
}

/** Seed every current local entity once after creating sync_state; preserves UUIDs and existing stamps. */
export async function seedSyncRecords(db: Database): Promise<SyncStateRow> {
  const scope = [db.sync_state, db.sync_records, db.groups, db.shortcuts, db.settings, db.assets] as const;
  return db.transaction('rw', scope, async () => {
    const state = await db.sync_state.get('app');
    if (!state) fail('创建同步状态后才能初始化同步记录');
    if (state.suspended) fail('接收远端数据期间不能初始化本机同步记录');

    const [groups, shortcuts, settingsRow, assets, previousRows] = await Promise.all([
      db.groups.toArray(), db.shortcuts.toArray(), db.settings.get('app'), db.assets.toArray(), db.sync_records.toArray(),
    ]);
    const prior = new Map(previousRows.map((row) => [row.id, row]));
    const clock = new SyncClock(state);
    const settings = settingsValue(settingsRow);
    let defaultGroupId = state.defaultGroupId;
    const defaultGroup = groups.find(({ isDefault }) => isDefault);
    if (!defaultGroup) fail('本地数据中缺少默认分组');
    if (defaultGroupId.value !== defaultGroup.id) defaultGroupId = clock.register(defaultGroup.id, defaultGroupId);

    const changes = seedEntityRecords({ groups, shortcuts, settings, assets, prior, clock, now: db.now() });

    if (changes.size > 0 || JSON.stringify(defaultGroupId) !== JSON.stringify(state.defaultGroupId)) {
      if (changes.size > 0) await db.sync_records.bulkPut([...changes.values()]);
      const nextState = clock.state({ ...state, defaultGroupId });
      await db.sync_state.put(nextState);
      return nextState;
    }
    return state;
  });
}
