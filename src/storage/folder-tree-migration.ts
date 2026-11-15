import type { Transaction } from 'dexie';
import { assertFolderTree } from '@/domain/folder';
import { upgradeSlotOrder, validateLayoutHidden, validateLayoutOrder, validateLayoutPreferences } from '@/domain/layout';
import { validateSettings } from '@/domain/settings';
import type { SettingsRow } from '@/storage/db';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow } from '@/storage/sync/types';

/**
 * 旧设置行把布局顺序升级到包含 `bookmarks` 的当前形状。
 *
 * 只在本机数据迁移里使用：既有相对顺序与隐藏项保持不变，缺失的区域追加到末尾，
 * 不重置任何用户的布局选择。
 */
export function upgradeStoredLayoutOrder<T extends { readonly layout?: unknown }>(settings: T): T {
  const layout = settings.layout as Record<string, unknown> | undefined;
  if (!layout || !Array.isArray(layout.order)) return settings;
  return { ...settings, layout: { ...layout, order: upgradeSlotOrder(layout.order) } };
}

type CurrentSettingsValue = Extract<SyncEntityRecordRow, { kind: 'settings' }>['value'];

interface LegacyLayoutRegister {
  readonly value: Record<string, unknown>;
  readonly clock: number;
  readonly deviceId: string;
}

interface LegacySettingsRecord extends Omit<Extract<SyncEntityRecordRow, { kind: 'settings' }>, 'value'> {
  readonly value: Omit<CurrentSettingsValue, 'layoutOrder' | 'layoutVisibility' | 'layoutPreferences'
    | 'bookmarksEnabled' | 'bookmarksMode' | 'bookmarksShowInSearch' | 'bookmarkRules'> & {
    readonly layout?: LegacyLayoutRegister;
  } & Partial<Pick<CurrentSettingsValue, 'layoutOrder' | 'layoutVisibility' | 'layoutPreferences'
    | 'bookmarksEnabled' | 'bookmarksMode' | 'bookmarksShowInSearch' | 'bookmarkRules'>>;
}

interface LegacyFolderRecord extends Omit<Extract<SyncEntityRecordRow, { kind: 'folder' }>, 'value'> {
  readonly value: Omit<Extract<SyncEntityRecordRow, { kind: 'folder' }>['value'], 'position'> & {
    readonly position: { readonly value: number | { readonly parentId: string | null; readonly order: number };
      readonly clock: number; readonly deviceId: string };
  };
}

function migrateFolderRecord(record: LegacyFolderRecord): Extract<SyncRecordRow, { kind: 'folder' }> {
  const position = record.value.position;
  if (typeof position.value !== 'number') return record as Extract<SyncRecordRow, { kind: 'folder' }>;
  // 位置是原子寄存器：补 `parentId: null`，沿用原时钟与设备，不让新字段凭空获得更高版本。
  return { ...record, value: { ...record.value,
    position: { ...position, value: { parentId: null, order: position.value } } } };
}

/**
 * 旧布局寄存器一拆为三：顺序、显隐、其余偏好各自独立，但**都沿用原来的 clock 与 deviceId**。
 *
 * 这样编辑区域顺序不会覆盖其他设备的显隐或布局偏好，也不会因为拆分而伪造更新的逻辑版本。
 */
function splitLegacyLayout(register: LegacyLayoutRegister) {
  const order = validateLayoutOrder(upgradeSlotOrder(register.value.order));
  const hidden = validateLayoutHidden(register.value.hidden);
  const preferences = validateLayoutPreferences({
    style: register.value.style,
    clockPosition: register.value.clockPosition,
    pageWidth: register.value.pageWidth,
    regionSpacing: register.value.regionSpacing,
    columns: register.value.columns,
  });
  return {
    layoutOrder: { value: { order }, clock: register.clock, deviceId: register.deviceId },
    layoutVisibility: { value: { hidden }, clock: register.clock, deviceId: register.deviceId },
    layoutPreferences: { value: preferences, clock: register.clock, deviceId: register.deviceId },
  };
}

/**
 * 设置记录的寄存器迁移：只补缺失字段。
 *
 * 已经是当前形状的记录（例如中断后重跑、或已写入过拆分寄存器）保持原寄存器、时钟与设备
 * 不动；`layout` 只在确实存在旧整块寄存器时才拆分。书签偏好寄存器同理：已存在的值不重置，
 * 只有缺失字段才补零时钟默认值，避免升级抹掉用户选择。
 */
function migrateSettingsRecord(record: LegacySettingsRecord, deviceId: string): Extract<SyncRecordRow, { kind: 'settings' }> {
  const { layout: legacyLayout, ...rest } = record.value;
  const base = rest as unknown as Omit<CurrentSettingsValue, 'layoutOrder' | 'layoutVisibility' | 'layoutPreferences'>;
  // 极端旧记录连布局寄存器都没有：补默认值，时钟从零开始，不继承其他字段。
  const fallback = () => splitLegacyLayout({
    value: { order: [], hidden: [], style: 'centered', clockPosition: 'left', pageWidth: 'standard',
      regionSpacing: 'standard', columns: 6 },
    clock: 0, deviceId,
  });
  const layout = {
    layoutOrder: record.value.layoutOrder
      ?? (legacyLayout ? splitLegacyLayout(legacyLayout).layoutOrder : fallback().layoutOrder),
    layoutVisibility: record.value.layoutVisibility
      ?? (legacyLayout ? splitLegacyLayout(legacyLayout).layoutVisibility : fallback().layoutVisibility),
    layoutPreferences: record.value.layoutPreferences
      ?? (legacyLayout ? splitLegacyLayout(legacyLayout).layoutPreferences : fallback().layoutPreferences),
  };
  const migrated: CurrentSettingsValue = { ...base, ...layout,
    // 新书签偏好没有历史值：从零开始，不改动任何既有选择、也不复活任何隐藏规则。
    bookmarksEnabled: record.value.bookmarksEnabled ?? { value: false, clock: 0, deviceId },
    bookmarksMode: record.value.bookmarksMode ?? { value: 'region', clock: 0, deviceId },
    bookmarksShowInSearch: record.value.bookmarksShowInSearch ?? { value: true, clock: 0, deviceId },
    bookmarkRules: record.value.bookmarkRules ?? {} };
  return { ...record, value: migrated };
}

/**
 * Dexie 15：自有文件夹变树（`parentId`）+ 布局增加 `bookmarks` + 同步设置寄存器拆分。
 *
 * 唯一允许的数据形状变更都集中在这一个升级事务里，失败整笔回滚；`sync_state`（含 suspended、
 * 基线标记与运行回执）与 `sync_keys` 原样保留，逻辑时钟与设备身份不被重写。
 */
export async function migrateFolderTree(transaction: Transaction): Promise<void> {
  const stateTable = transaction.table('sync_state');
  const settingsTable = transaction.table('settings');
  const foldersTable = transaction.table('folders');
  const recordsTable = transaction.table('sync_records');
  const state = await stateTable.get('app') as SyncStateRow | undefined;
  const settings = await settingsTable.get('app') as SettingsRow | undefined;
  const staleRecord = (await recordsTable.get('settings:app')) as SyncRecordRow | undefined;
  if (staleRecord?.kind === 'settings' && !state) throw new Error('同步设置记录缺少设备身份，数据库升级已回滚');
  if (state) await stateTable.put({ ...state, suspended: true });
  if (settings) await settingsTable.put({ id: 'app', ...validateSettings(upgradeStoredLayoutOrder(settings)) });
  const folders = await foldersTable.toArray() as Array<Record<string, unknown>>;
  const upgradedFolders = folders.map((folder) => Object.hasOwn(folder, 'parentId') ? folder : { ...folder, parentId: null });
  // 旧数据只可能是扁平列表，但升级仍按完整树校验：缺失 parent 或成环整笔回滚，不做部分修补。
  assertFolderTree(upgradedFolders.map((folder) => ({
    id: String(folder.id),
    parentId: (folder.parentId ?? null) as string | null,
  })));
  if (folders.some((folder) => !Object.hasOwn(folder, 'parentId'))) await foldersTable.bulkPut(upgradedFolders);
  const records = await recordsTable.toArray() as SyncRecordRow[];
  if (records.length > 0) {
    const migrated = records.map((record) => {
      if (record.kind === 'folder') return migrateFolderRecord(record as LegacyFolderRecord);
      if (record.kind === 'settings') return migrateSettingsRecord(record as LegacySettingsRecord, state!.deviceId);
      return record;
    });
    await recordsTable.bulkPut(migrated);
  }
  if (state) await stateTable.put(state);
}
