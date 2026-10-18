import type { Database } from '@/storage/db';
import { buildTombstoneRecord, SyncClock } from '@/storage/sync/builders';
import type { SyncRecordRow } from '@/storage/sync/types';

function isExpiredShortcut(row: SyncRecordRow, now: number): row is Extract<SyncRecordRow, { kind: 'shortcut' }> {
  return row.kind === 'shortcut' && row.pendingDeleteUntil !== undefined && now >= row.pendingDeleteUntil;
}

function withoutRetainedAsset(row: Extract<SyncRecordRow, { kind: 'asset' }>): Extract<SyncRecordRow, { kind: 'asset' }> {
  if (!row.retainedAsset) return row;
  const { retainedAsset: _retainedAsset, ...next } = row;
  return next;
}

function referencedByPendingShortcut(assetId: string, rows: readonly SyncRecordRow[], now: number): boolean {
  return rows.some((row) => row.kind === 'shortcut' && row.pendingDeleteUntil !== undefined && now < row.pendingDeleteUntil &&
    row.value.icon.value.kind === 'asset' && row.value.icon.value.assetId === assetId);
}

function updateExpiredShortcuts(rows: readonly SyncRecordRow[], now: number, clock: SyncClock): SyncRecordRow[] {
  return rows.filter((row) => isExpiredShortcut(row, now))
    .map((row) => buildTombstoneRecord({ kind: 'shortcut', entityId: row.entityId, previous: row, clock }));
}

async function retainedAssetRows(input: { readonly shortcuts: readonly SyncRecordRow[]; readonly now: number;
  readonly records: Database['sync_records']; }): Promise<Extract<SyncRecordRow, { kind: 'asset' }>[]> {
  const expired = input.shortcuts.filter((row) => isExpiredShortcut(row, input.now));
  const candidates = new Set(expired.flatMap((row) => row.value.icon.value.kind === 'asset' ? [row.value.icon.value.assetId] : []));
  const survivors = input.shortcuts.filter((row) => row.kind === 'shortcut' && !isExpiredShortcut(row, input.now));
  const selected: Extract<SyncRecordRow, { kind: 'asset' }>[] = [];
  for (const assetId of candidates) {
    if (referencedByPendingShortcut(assetId, survivors, input.now)) continue;
    const row = await input.records.get(`asset:${assetId}`);
    if (row?.kind === 'asset' && row.retainedAsset) selected.push(row);
  }
  return selected;
}

function tombstonesFor(shortcuts: readonly SyncRecordRow[], now: number, clock: SyncClock): SyncRecordRow[] {
  return updateExpiredShortcuts(shortcuts, now, clock);
}

async function nextRows(input: { readonly shortcuts: readonly SyncRecordRow[]; readonly now: number;
  readonly clock: SyncClock; readonly records: Database['sync_records'] }): Promise<{ rows: SyncRecordRow[]; finalized: number }> {
  const expired = tombstonesFor(input.shortcuts, input.now, input.clock);
  const retained = await retainedAssetRows({ shortcuts: input.shortcuts, now: input.now, records: input.records });
  for (const row of retained) input.clock.markChanged();
  return { rows: [...expired, ...retained.map(withoutRetainedAsset)], finalized: expired.length };
}

/** Converts elapsed local undo windows into sync tombstones before an export. */
export async function finalizePendingDeletes(db: Database, now = db.now()): Promise<number> {
  return db.transaction('rw', db.sync_state, db.sync_records, async () => {
    const state = await db.sync_state.get('app');
    if (!state || state.suspended) return 0;
    const records = await db.sync_records.where('kind').equals('shortcut').toArray();
    const clock = new SyncClock(state);
    const next = await nextRows({ shortcuts: records, now, clock, records: db.sync_records });
    if (next.rows.length === 0) return 0;
    if (clock.changed) {
      await db.sync_records.bulkPut(next.rows);
      await db.sync_state.put(clock.state(state));
    }
    return next.finalized;
  });
}

/** 用户确认的整库替换/重置没有网站撤销窗口，立即传播旧身份的永久删除。 */
export async function tombstoneReplacedShortcuts(db: Database): Promise<void> {
  const state = await db.sync_state.get('app');
  if (!state || state.suspended) return;
  const records = await db.sync_records.where('kind').equals('shortcut').toArray();
  const clock = new SyncClock(state);
  const tombstones = records.map((previous) => buildTombstoneRecord({ kind: 'shortcut', entityId: previous.entityId, previous, clock }));
  if (tombstones.length === 0) return;
  await db.sync_records.bulkPut(tombstones);
  await db.sync_state.put(clock.state(state));
}
