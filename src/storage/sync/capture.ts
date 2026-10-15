import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable } from 'dexie';
import type { Group } from '@/domain/group';
import type { MediaAsset } from '@/domain/asset';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow } from '@/storage/sync/types';
import { buildAssetRecord, buildEngineRecord, buildGroupRecord, buildSettingsRecord, buildShortcutRecord,
  buildTombstoneRecord, recordId, SyncClock } from '@/storage/sync/builders';
import { readAfterRows, readBeforeRows, requestKeys, type MutationRows } from '@/storage/sync/requests';

export { finalizePendingDeletes } from '@/storage/sync/pending-deletes';
export { seedSyncRecords } from '@/storage/sync/seed';

export const SHORTCUT_UNDO_WINDOW_MS = 5_000;
const TRACKED_TABLES = ['groups', 'shortcuts', 'settings', 'assets'] as const;
type TrackedTable = (typeof TRACKED_TABLES)[number];
type TableRow = Group | Shortcut | (AppSettings & { readonly id: 'app' }) | MediaAsset;

export function isTrackedTable(name: string): name is TrackedTable {
  return TRACKED_TABLES.includes(name as TrackedTable);
}

interface MutationCaptureInput {
  readonly core: DBCore;
  readonly name: TrackedTable;
  readonly table: DBCoreTable;
  readonly request: DBCoreMutateRequest;
  readonly now: () => number;
}

export async function mutateWithCapture(input: MutationCaptureInput): Promise<DBCoreMutateResponse> {
  const { core, name, table, request, now } = input;
  const state = await core.table('sync_state').get({ trans: request.trans, key: 'app' }) as SyncStateRow | undefined;
  if (!state || state.suspended) return table.mutate(request);
  await validateShortcutRestore({ core, name, table, request, now: now() });
  const before = await readBeforeRows(table, request);
  const response = await table.mutate(request);
  const rows = await readAfterRows({ table, request, response, rows: before });
  await captureChangedRows({ core, name, rows, now });
  return response;
}

async function validateShortcutRestore(input: Omit<MutationCaptureInput, 'now'> & { readonly now: number }): Promise<void> {
  const { core, name, table, request, now } = input;
  if (!isShortcutWrite({ name, request })) return;
  const keys = requestKeys(table, request) ?? [];
  if (keys.length === 0) return;
  const records = await core.table('sync_records').getMany({ trans: request.trans,
    keys: keys.map((key) => recordId('shortcut', String(key))) }) as Array<SyncRecordRow | undefined>;
  validateRestorationRecords({ records, now });
}

function isShortcutWrite(input: { readonly name: TrackedTable; readonly request: DBCoreMutateRequest }): boolean {
  return input.name === 'shortcuts' && input.request.type !== 'delete' && input.request.type !== 'deleteRange';
}

function validateRestorationRecords(input: { readonly records: readonly (SyncRecordRow | undefined)[]; readonly now: number }): void {
  for (const record of input.records) validateRestorationRecord({ record, now: input.now });
}

function validateRestorationRecord(input: { readonly record: SyncRecordRow | undefined; readonly now: number }): void {
  const { record, now } = input;
  if (record?.kind === 'tombstone' && record.tombstone.entityType === 'shortcut') throw new Error('已同步删除的网站不能复活');
  if (record?.kind !== 'shortcut') return;
  if (record.pendingDeleteUntil !== undefined && now >= record.pendingDeleteUntil) throw new Error('网站撤销期限已过，不能恢复');
}

async function captureChangedRows(input: { readonly core: DBCore; readonly name: TrackedTable; readonly rows: MutationRows; readonly now: () => number }): Promise<void> {
  const { core, name, rows, now } = input;
  const state = await core.table('sync_state').get({ trans: rows.transaction, key: 'app' }) as SyncStateRow | undefined;
  if (!state || state.suspended) return;
  const clock = new SyncClock(state);
  let defaultGroupId = state.defaultGroupId;
  let changes = new Map<string, SyncRecordRow>();
  const beforeIds = new Set(rows.before.map(({ id }) => id));
  const afterIds = new Set(rows.after.map(({ id }) => id));
  const ids = new Set([...beforeIds, ...afterIds]);
  for (const id of ids) {
    const before = rows.before.find((row) => row.id === id) as TableRow | undefined;
    const after = rows.after.find((row) => row.id === id) as TableRow | undefined;
    const result = await captureEntity({ core, rows, name, id, before, after, now: now(), clock, changes, defaultGroupId });
    defaultGroupId = result.defaultGroupId;
    changes = result.changes;
  }
  if (name === 'groups') changes = await tombstoneGroupChildren({ core, rows, changes, clock });
  if (clock.changed) {
    await putRecords({ core, rows, records: [...changes.values()] });
    await putState({ core, rows, state: clock.state({ ...state, defaultGroupId }) });
  }
}

interface CaptureEntityInput {
  readonly core: DBCore;
  readonly rows: MutationRows;
  readonly name: TrackedTable;
  readonly id: string;
  readonly before: TableRow | undefined;
  readonly after: TableRow | undefined;
  readonly now: number;
  readonly clock: SyncClock;
  readonly changes: Map<string, SyncRecordRow>;
  readonly defaultGroupId: SyncStateRow['defaultGroupId'];
}

async function captureEntity(input: CaptureEntityInput): Promise<{ defaultGroupId: SyncStateRow['defaultGroupId']; changes: Map<string, SyncRecordRow> }> {
  const { core, rows, name, id, before, after, now, clock, defaultGroupId } = input;
  let changes = input.changes;
  if (name === 'groups') return captureGroup({ core, rows, id, before: before as Group | undefined,
    after: after as Group | undefined, clock, changes, defaultGroupId });
  if (name === 'shortcuts') changes = await captureShortcut({ core, rows, id,
    before: before as Shortcut | undefined, after: after as Shortcut | undefined, now, clock, changes });
  if (name === 'assets') changes = await captureAsset({ core, rows, id,
    before: before as MediaAsset | undefined, after: after as MediaAsset | undefined, clock, changes });
  if (name === 'settings' && after) changes = await captureSettings({ core, rows, settings: after as AppSettings & { id: 'app' }, clock, changes });
  return { defaultGroupId, changes };
}

interface PriorRecordInput {
  readonly core: DBCore;
  readonly rows: MutationRows;
  readonly kind: SyncEntityRecordRow['kind'];
  readonly id: string;
  readonly changes: Map<string, SyncRecordRow>;
}

async function priorRecord(input: PriorRecordInput): Promise<SyncRecordRow | undefined> {
  const { core, rows, kind, id, changes } = input;
  const key = recordId(kind, id);
  if (changes.has(key)) return changes.get(key);
  return core.table('sync_records').get({ trans: rows.transaction, key }) as Promise<SyncRecordRow | undefined>;
}

interface CaptureGroupInput {
  readonly core: DBCore; readonly rows: MutationRows; readonly id: string; readonly before?: Group; readonly after?: Group;
  readonly clock: SyncClock; readonly changes: Map<string, SyncRecordRow>; readonly defaultGroupId: SyncStateRow['defaultGroupId'];
}

async function captureGroup(input: CaptureGroupInput): Promise<{ defaultGroupId: SyncStateRow['defaultGroupId']; changes: Map<string, SyncRecordRow> }> {
  const { core, rows, id, before, after, clock, changes, defaultGroupId } = input;
  const prior = await priorRecord({ core, rows, kind: 'group', id, changes });
  if (after) {
    if (prior?.kind === 'tombstone') throw new Error('已同步删除的分组不能复活');
    const next = buildGroupRecord({ group: after, previous: prior, before, clock });
    const updated = assignIfChanged({ changes, previous: prior, next, clock });
    const nextDefault = after.isDefault && defaultGroupId.value !== after.id ? clock.register(after.id, defaultGroupId) : defaultGroupId;
    return { defaultGroupId: nextDefault, changes: updated };
  }
  if (!before || prior?.kind === 'tombstone') return { defaultGroupId, changes };
  const live = prior ?? buildGroupRecord({ group: before, clock });
  const next = buildTombstoneRecord({ kind: 'group', entityId: id, previous: live, clock });
  return { defaultGroupId, changes: setRecord(changes, next) };
}

interface CaptureShortcutInput {
  readonly core: DBCore; readonly rows: MutationRows; readonly id: string; readonly before?: Shortcut; readonly after?: Shortcut;
  readonly now: number; readonly clock: SyncClock; readonly changes: Map<string, SyncRecordRow>;
}

async function captureShortcut(input: CaptureShortcutInput): Promise<Map<string, SyncRecordRow>> {
  const { core, rows, id, before, after, now, clock, changes } = input;
  const prior = await priorRecord({ core, rows, kind: 'shortcut', id, changes });
  if (after) {
    if (prior?.kind === 'tombstone') throw new Error('已同步删除的网站不能复活');
    const next = buildShortcutRecord({ shortcut: after, previous: prior, before, clock });
    if (prior?.pendingDeleteUntil !== undefined) clock.markChanged();
    return assignIfChanged({ changes, previous: prior, next, clock });
  }
  if (!before || prior?.kind === 'tombstone' || prior?.pendingDeleteUntil !== undefined) return changes;
  const live = prior ?? buildShortcutRecord({ shortcut: before, clock });
  clock.markChanged();
  return setRecord(changes, { ...live, pendingDeleteUntil: now + SHORTCUT_UNDO_WINDOW_MS });
}

interface CaptureAssetInput {
  readonly core: DBCore; readonly rows: MutationRows; readonly id: string; readonly before?: MediaAsset; readonly after?: MediaAsset;
  readonly clock: SyncClock; readonly changes: Map<string, SyncRecordRow>;
}

async function captureAsset(input: CaptureAssetInput): Promise<Map<string, SyncRecordRow>> {
  const { core, rows, id, before, after, clock, changes } = input;
  const prior = await priorRecord({ core, rows, kind: 'asset', id, changes });
  if (after) {
    if (prior?.kind === 'tombstone') throw new Error('已同步删除的图片资源不能复活');
    const next = buildAssetRecord(after, prior, clock);
    return assignIfChanged({ changes, previous: prior, next, clock });
  }
  if (!before) return changes;
  const metadata = prior ?? buildAssetRecord(before, undefined, clock);
  const pending = await pendingShortcuts({ core, rows, changes, assetId: id });
  const next = pending.length > 0 ? { ...metadata, retainedAsset: before } : withoutRetainedAsset(metadata);
  return assignIfChanged({ changes, previous: prior, next, clock });
}

interface CaptureSettingsInput {
  readonly core: DBCore; readonly rows: MutationRows; readonly settings: AppSettings & { id: 'app' };
  readonly clock: SyncClock; readonly changes: Map<string, SyncRecordRow>;
}

async function captureSettings(input: CaptureSettingsInput): Promise<Map<string, SyncRecordRow>> {
  const { core, rows, settings, clock } = input;
  let changes = input.changes;
  const previous = await priorRecord({ core, rows, kind: 'settings', id: 'app', changes });
  changes = assignIfChanged({ changes, previous, next: buildSettingsRecord(settings, previous, clock), clock });
  const priorEngines = await allRecords({ core, rows, kind: 'custom-engine' });
  const nextEngines = new Map(settings.search.customEngines.map((engine) => [engine.id, engine]));
  for (const engine of settings.search.customEngines) {
    const prior = changes.get(recordId('custom-engine', engine.id)) ?? await priorRecord({ core, rows, kind: 'custom-engine', id: engine.id, changes });
    if (prior?.kind === 'tombstone') throw new Error('已删除的搜索引擎标识不能复用');
    changes = assignIfChanged({ changes, previous: prior, next: buildEngineRecord(engine, prior, clock), clock });
  }
  for (const prior of priorEngines) {
    if (nextEngines.has(prior.entityId)) continue;
    changes = setRecord(changes, buildTombstoneRecord({ kind: 'custom-engine', entityId: prior.entityId, previous: prior, clock }));
  }
  return changes;
}

interface GroupCascadeInput { readonly core: DBCore; readonly rows: MutationRows; readonly changes: Map<string, SyncRecordRow>; readonly clock: SyncClock }

async function tombstoneGroupChildren(input: GroupCascadeInput): Promise<Map<string, SyncRecordRow>> {
  const { core, rows, changes, clock } = input;
  const deletedGroups = [...changes.values()].filter((row) => row.kind === 'tombstone' && row.tombstone.entityType === 'group').map((row) => row.entityId);
  if (deletedGroups.length === 0) return changes;
  const shortcuts = await allRecords({ core, rows, kind: 'shortcut' });
  let nextChanges = changes;
  for (const previous of shortcuts) {
    if (previous.kind !== 'shortcut' || !deletedGroups.includes(previous.value.placement.value.groupId)) continue;
    nextChanges = setRecord(nextChanges, buildTombstoneRecord({ kind: 'shortcut', entityId: previous.entityId, previous, clock }));
  }
  return nextChanges;
}

async function pendingShortcuts(input: { readonly core: DBCore; readonly rows: MutationRows; readonly changes: ReadonlyMap<string, SyncRecordRow>; readonly assetId: string }): Promise<SyncRecordRow[]> {
  const { core, rows, changes, assetId } = input;
  const records = await allRecords({ core, rows, kind: 'shortcut' });
  return records.map((row) => changes.get(row.id) ?? row).filter((row) => row.kind === 'shortcut' &&
    row.pendingDeleteUntil !== undefined && row.value.icon.value.kind === 'asset' && row.value.icon.value.assetId === assetId);
}

async function allRecords<K extends SyncEntityRecordRow['kind']>(input: { readonly core: DBCore; readonly rows: MutationRows; readonly kind: K }): Promise<Array<Extract<SyncEntityRecordRow, { kind: K }>>> {
  const { core, rows, kind } = input;
  const table = core.table('sync_records');
  const index = table.schema.getIndexByKeyPath('kind');
  if (!index) throw new Error('同步记录表缺少 kind 索引');
  const query = { index, range: { type: 1, lower: kind, upper: kind } };
  return (await table.query({ trans: rows.transaction, query, values: true })).result as Array<Extract<SyncEntityRecordRow, { kind: K }>>;
}

function assignIfChanged(input: { readonly changes: Map<string, SyncRecordRow>; readonly previous?: SyncRecordRow;
  readonly next: SyncRecordRow; readonly clock: SyncClock }): Map<string, SyncRecordRow> {
  const { changes, previous, next, clock } = input;
  if (JSON.stringify(previous) === JSON.stringify(next)) return changes;
  clock.markChanged();
  return setRecord(changes, next);
}

function setRecord(records: ReadonlyMap<string, SyncRecordRow>, row: SyncRecordRow): Map<string, SyncRecordRow> {
  const next = new Map(records);
  next.set(row.id, row);
  return next;
}

function withoutRetainedAsset(record: SyncRecordRow): SyncRecordRow {
  if (!('retainedAsset' in record)) return record;
  const { retainedAsset: _retainedAsset, ...next } = record;
  return next as SyncRecordRow;
}

async function putRecords(input: { readonly core: DBCore; readonly rows: MutationRows; readonly records: readonly SyncRecordRow[] }): Promise<void> {
  const { core, rows, records } = input;
  if (records.length === 0) return;
  const response = await core.table('sync_records').mutate({ type: 'put', trans: rows.transaction, values: records });
  if (response.numFailures > 0) throw new Error('同步元数据写入失败');
}

async function putState(input: { readonly core: DBCore; readonly rows: MutationRows; readonly state: SyncStateRow }): Promise<void> {
  const { core, rows, state } = input;
  const response = await core.table('sync_state').mutate({ type: 'put', trans: rows.transaction, values: [state] });
  if (response.numFailures > 0) throw new Error('同步状态写入失败');
}
