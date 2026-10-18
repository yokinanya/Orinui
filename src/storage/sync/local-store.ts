import { fail } from '@/domain/errors';
import type { Database } from '@/storage/db';
import { applySyncSnapshot } from '@/storage/sync/apply';
import type { SyncStateRow } from '@/storage/sync/types';
import { exportSyncSnapshot } from '@/storage/sync/export';
import type { SyncApplyDependencies } from '@/storage/sync/apply-validation';
import type { SyncRunRecord } from '@/sync/types';
import type { SyncLocalExport, SyncLocalPreview, SyncLocalStore, SyncRunIdentity } from '@/sync/ports';

const STATE_ID = 'app' as const;

function assertIdentity(state: SyncStateRow | undefined, identity: SyncRunIdentity): asserts state is SyncStateRow {
  if (!state || state.vaultId !== identity.vaultId || state.deviceId !== identity.deviceId) {
    fail('同步库连接已变化');
  }
  assertRunning(state.lastSync, identity.runId);
}

function assertRunning(record: SyncRunRecord | undefined, runId: string): asserts record is SyncRunRecord {
  if (!record || record.runId !== runId || record.status !== 'running') fail('同步运行已结束或已被新的运行取代');
}

function runRecord(runId: string, startedAt: number): SyncRunRecord {
  return { runId, status: 'running', phase: 'reading', publication: 'not-started', startedAt };
}

function identityOf(input: SyncRunIdentity): SyncRunIdentity {
  return { runId: input.runId, vaultId: input.vaultId, deviceId: input.deviceId };
}

export function createSyncLocalStore(db: Database, dependencies: SyncApplyDependencies): SyncLocalStore {
  return {
    scope: db.name,
    begin: (input) => beginRun(db, input),
    preview: () => previewLocal(db, dependencies),
    export: (input) => exportLocal(db, dependencies, input),
    assertCurrent: (input) => assertCurrent(db, input),
    markPhase: (input) => updatePhase(db, input),
    apply: (input) => applyLocal(db, dependencies, input),
    finish: (input) => finishRun(db, input),
    fail: (input) => failRun(db, input),
  };
}

async function previewLocal(db: Database, dependencies: SyncApplyDependencies): Promise<SyncLocalPreview> {
  const before = await db.transaction('r', [db.sync_state, db.sync_keys], async () => {
    const state = await db.sync_state.get(STATE_ID);
    if (!state) fail('本机尚未配置同步库');
    if (state.suspended) fail('正在接收远端数据，暂时无法生成容量预览');
    const key = await db.sync_keys.get(state.vaultId);
    if (!key) fail('本机同步密钥不存在，需要恢复密钥');
    return { state, key: key.key };
  });
  const local = await exportSyncSnapshot(db, dependencies.crypto, { finalizeExpiredDeletes: false });
  const after = await db.sync_state.get(STATE_ID);
  if (!after || after.vaultId !== before.state.vaultId || after.deviceId !== before.state.deviceId
    || after.generation !== before.state.generation || after.suspended) {
    fail('本机数据在容量预览期间已变化，请重新预览');
  }
  return { session: { vaultId: before.state.vaultId, deviceId: before.state.deviceId, key: before.key,
    hasBaseline: before.state.hasAcceptedSnapshot === true || before.state.lastSuccessfulSync !== undefined }, local };
}

async function beginRun(db: Database, input: Parameters<SyncLocalStore['begin']>[0]): Promise<Awaited<ReturnType<SyncLocalStore['begin']>>> {
  return db.transaction('rw', [db.sync_state, db.sync_keys], async () => {
    const state = await db.sync_state.get(STATE_ID);
    if (!state) fail('本机尚未配置同步库');
    const key = await db.sync_keys.get(state.vaultId);
    if (!key) fail('本机同步密钥不存在，需要恢复密钥');
    await db.sync_state.put({ ...state, lastSync: runRecord(input.runId, input.startedAt) });
    return { vaultId: state.vaultId, deviceId: state.deviceId, key: key.key,
      hasBaseline: state.hasAcceptedSnapshot === true || state.lastSuccessfulSync !== undefined };
  });
}

async function exportLocal(db: Database, dependencies: SyncApplyDependencies, identity: SyncRunIdentity): Promise<SyncLocalExport> {
  const expected = identityOf(identity);
  await assertCurrentRun(db, expected);
  const exported = await exportSyncSnapshot(db, dependencies.crypto);
  await assertCurrentRun(db, expected);
  assertExportIdentity(exported, expected);
  return exported;
}

async function assertCurrent(db: Database, input: Parameters<SyncLocalStore['assertCurrent']>[0]): Promise<void> {
  await db.transaction('r', db.sync_state, async () => {
    const state = await db.sync_state.get(STATE_ID);
    assertIdentity(state, input);
    if (input.expectedGeneration !== undefined && state.generation !== input.expectedGeneration) {
      fail('本机数据在同步期间已变化，请重新合并后再试');
    }
  });
}

async function updatePhase(db: Database, input: Parameters<SyncLocalStore['markPhase']>[0]): Promise<void> {
  await db.transaction('rw', db.sync_state, async () => {
    const state = await db.sync_state.get(STATE_ID);
    assertIdentity(state, input);
    const lastSync = state.lastSync;
    assertRunning(lastSync, input.runId);
    await db.sync_state.put({ ...state, lastSync: { ...lastSync, phase: input.phase,
      publication: input.publication } });
  });
}

async function applyLocal(db: Database, dependencies: SyncApplyDependencies,
  input: Parameters<SyncLocalStore['apply']>[0]): Promise<void> {
  await applySyncSnapshot(db, { snapshot: input.snapshot, assets: input.assets,
    expectedGeneration: input.expectedGeneration, syncRun: { runId: input.runId, appliedAt: input.appliedAt } }, dependencies);
}

async function finishRun(db: Database, input: Parameters<SyncLocalStore['finish']>[0]): Promise<Awaited<ReturnType<SyncLocalStore['finish']>>> {
  return db.transaction('rw', db.sync_state, async () => {
    const state = await db.sync_state.get(STATE_ID);
    assertIdentity(state, input);
    const lastSync = state.lastSync;
    assertRunning(lastSync, input.runId);
    if (lastSync.appliedGeneration !== input.publishedGeneration) fail('发布代次与本机已应用代次不一致');
    return finishState(db, { state, publishedGeneration: input.publishedGeneration,
      revision: input.revision, completedAt: input.completedAt, lastSync });
  });
}

interface FinishStateInput {
  readonly state: SyncStateRow;
  readonly publishedGeneration: number;
  readonly revision: string;
  readonly completedAt: number;
  readonly lastSync: SyncRunRecord;
}

async function finishState(db: Database, input: FinishStateInput): Promise<{ readonly localGeneration: number; readonly pendingEdits: boolean }> {
  const { state, publishedGeneration, revision, completedAt, lastSync } = input;
  const pendingEdits = state.generation > publishedGeneration;
  await db.sync_state.put({ ...state, lastSuccessfulSync: { at: completedAt, generation: publishedGeneration, revision },
    lastSync: { ...lastSync, status: 'succeeded', phase: 'complete', publication: 'confirmed',
      finishedAt: completedAt, pendingEdits } });
  return { localGeneration: state.generation, pendingEdits };
}

async function failRun(db: Database, input: Parameters<SyncLocalStore['fail']>[0]): Promise<boolean> {
  return db.transaction('rw', db.sync_state, async () => {
    const state = await db.sync_state.get(STATE_ID);
    if (!ownsRun(state, input)) return false;
    const lastSync = state.lastSync;
    if (!lastSync) return false;
    await db.sync_state.put({ ...state, lastSync: { ...lastSync, status: 'failed', phase: input.phase,
      publication: input.publication, finishedAt: input.failedAt, error: input.error } });
    return true;
  });
}

function ownsRun(state: SyncStateRow | undefined, input: SyncRunIdentity): state is SyncStateRow & { readonly lastSync: SyncRunRecord } {
  return state?.vaultId === input.vaultId && state.deviceId === input.deviceId
    && state.lastSync?.runId === input.runId && state.lastSync.status === 'running';
}

async function assertCurrentRun(db: Database, identity: SyncRunIdentity): Promise<void> {
  await db.transaction('r', db.sync_state, async () => {
    assertIdentity(await db.sync_state.get(STATE_ID), identity);
  });
}

function assertExportIdentity(exported: SyncLocalExport, identity: SyncRunIdentity): void {
  if (exported.snapshot.vaultId !== identity.vaultId || exported.snapshot.deviceId !== identity.deviceId) {
    fail('导出的本机快照身份与同步运行不一致');
  }
}
