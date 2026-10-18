import { fail } from '@/domain/errors';
import type { MediaAsset } from '@/domain/asset';
import { materializeSyncSnapshot, maximumSyncClock, nextSyncCounter } from '@/domain/sync';
import type { SyncSnapshot } from '@/domain/sync';
import type { Database, SettingsRow } from '@/storage/db';
import type { SyncRecordRow, SyncStateRow } from '@/storage/sync/types';
import type { SyncRunRecord } from '@/sync/types';
import { buildAppliedRows } from '@/storage/sync/apply-records';
import { validateSyncPayload, type SyncApplyDependencies, type ValidatedSyncPayload } from '@/storage/sync/apply-validation';

export interface ApplySyncSnapshotInput {
  readonly snapshot: SyncSnapshot;
  readonly assets: readonly MediaAsset[];
  readonly expectedGeneration: number;
  readonly syncRun?: { readonly runId: string; readonly appliedAt: number };
}

function nextObservedClock(snapshot: SyncSnapshot, current: number): number {
  const maximum = Math.max(current, maximumSyncClock(snapshot));
  nextSyncCounter(maximum);
  return maximum;
}

function validateApplyIdentity(state: SyncStateRow, input: ApplySyncSnapshotInput): void {
  if (state.vaultId !== input.snapshot.vaultId) fail('同步库标识不匹配');
  if (state.deviceId !== input.snapshot.deviceId) fail('不能直接应用其他设备的未合并快照');
}

function validateCounter(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail('本机同步状态计数器不正确');
}

function validateExpectedGeneration(state: SyncStateRow, input: ApplySyncSnapshotInput): void {
  if (state.generation !== input.expectedGeneration) fail('本机数据在同步期间已变化，请重新合并后再试');
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) fail('本机同步代次不正确');
  if (input.snapshot.generation < input.expectedGeneration) fail('合并快照代次早于本机数据');
}

function validateApplyState(state: SyncStateRow | undefined, input: ApplySyncSnapshotInput): asserts state is SyncStateRow {
  if (!state) fail('同步尚未启用，不能应用云端数据');
  validateApplyIdentity(state, input);
  if (state.suspended) fail('同步应用事务已处于挂起状态');
  validateCounter(state.clock);
  validateCounter(state.generation);
  validateExpectedGeneration(state, input);
  if (input.syncRun) validateSyncRun(state.lastSync, input.syncRun.runId);
}

function validateSyncRun(lastSync: SyncRunRecord | undefined, runId: string): void {
  if (!lastSync || lastSync.runId !== runId || lastSync.status !== 'running') fail('同步运行已结束或已被新的运行取代');
}

interface ReplaceRowsInput {
  readonly db: Database;
  readonly payload: ValidatedSyncPayload;
  readonly state: SyncStateRow;
  readonly applied: ReturnType<typeof buildAppliedRows>;
  readonly syncRun?: { readonly runId: string; readonly appliedAt: number };
}

async function replaceRows({ db, payload, state, applied, syncRun }: ReplaceRowsInput): Promise<void> {
  await db.folders.clear();
  if (applied.folders.length > 0) await db.folders.bulkPut([...applied.folders]);
  await db.shortcuts.clear();
  if (applied.shortcuts.length > 0) await db.shortcuts.bulkPut([...applied.shortcuts]);
  await db.settings.clear();
  await db.settings.put({ ...applied.settings, id: 'app' } satisfies SettingsRow);
  await db.assets.clear();
  if (applied.assets.length > 0) await db.assets.bulkPut([...applied.assets]);
  await db.sync_records.clear();
  if (applied.records.length > 0) await db.sync_records.bulkPut([...applied.records]);
  const lastSync = syncRun ? inputSyncRun(state.lastSync, payload.snapshot.generation, syncRun.appliedAt) : state.lastSync;
  await db.sync_state.put({ ...state,
    clock: nextObservedClock(payload.snapshot, state.clock), generation: payload.snapshot.generation, suspended: false,
    hasAcceptedSnapshot: true,
    ...(lastSync ? { lastSync } : {}) });
}

function inputSyncRun(lastSync: SyncRunRecord | undefined, generation: number, appliedAt: number): SyncRunRecord {
  if (!lastSync) fail('同步运行记录丢失');
  return { ...lastSync, appliedGeneration: generation, appliedAt, phase: 'uploading-media' };
}

export async function applySyncSnapshot(db: Database, input: ApplySyncSnapshotInput,
  dependencies: SyncApplyDependencies): Promise<void> {
  const payload = await validateSyncPayload({ snapshot: input.snapshot, assets: input.assets }, dependencies);
  const materialized = materializeSyncSnapshot(payload.snapshot);
  await db.transaction('rw', [db.folders, db.shortcuts, db.settings, db.assets, db.sync_state, db.sync_records], async () => {
    const state = await db.sync_state.get('app');
    validateApplyState(state, input);
    await db.sync_state.put({ ...state, suspended: true });
    const existingRecords = await db.sync_records.toArray();
    const applied = buildAppliedRows({ snapshot: payload.snapshot, materialized, existingRecords,
      incomingAssets: payload.assets, now: db.now() });
    await replaceRows({ db, payload, state, applied, syncRun: input.syncRun });
  });
}
