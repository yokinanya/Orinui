import type { MediaAsset } from '@/domain/asset';
import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { SearchEngine } from '@/domain/search-engines';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncAsset, SyncGroup, SyncRegister, SyncSettings, SyncShortcut, SyncTombstone } from '@/domain/sync/types';
import { nextSyncCounter } from '@/domain/sync/version';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow, SyncTombstoneRecordRow } from '@/storage/sync/types';

export class SyncClock {
  private current: number;
  private dirty = false;
  readonly deviceId: string;

  constructor(state: SyncStateRow) {
    this.current = state.clock;
    this.deviceId = state.deviceId;
  }

  register<T>(value: T, previous?: SyncRegister<T>): SyncRegister<T> {
    if (previous && sameValue(previous.value, value)) return previous;
    this.dirty = true;
    this.current = nextSyncCounter(this.current);
    return { value, clock: this.current, deviceId: this.deviceId };
  }

  tombstone(entityType: SyncTombstone['entityType'], id: string): SyncTombstone {
    this.dirty = true;
    this.current = nextSyncCounter(this.current);
    return { entityType, id, clock: this.current, deviceId: this.deviceId };
  }

  markChanged(): void {
    this.dirty = true;
  }

  state(state: SyncStateRow): SyncStateRow {
    return { ...state, clock: this.current, generation: this.dirty ? nextSyncCounter(state.generation) : state.generation };
  }

  get changed(): boolean {
    return this.dirty;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function recordId<K extends SyncEntityRecordRow['kind']>(kind: K, entityId: string): `${K}:${string}` {
  return `${kind}:${entityId}`;
}

function livePrevious<K extends SyncEntityRecordRow['kind']>(
  record: SyncRecordRow | undefined,
  kind: K,
): Extract<SyncEntityRecordRow, { readonly kind: K }> | undefined {
  return record?.kind === kind ? record as Extract<SyncEntityRecordRow, { readonly kind: K }> : undefined;
}

interface BuildGroupRecordInput {
  readonly group: Group;
  readonly previous?: SyncRecordRow;
  readonly before?: Group;
  readonly clock: SyncClock;
}

export function buildGroupRecord(input: BuildGroupRecordInput): Extract<SyncRecordRow, { kind: 'group' }> {
  const { group, previous, before, clock } = input;
  const old = livePrevious(previous, 'group');
  const value: SyncGroup = {
    id: group.id,
    name: registerAfterCompare({ value: group.name, previous: old?.value.name, before: before?.name, hasBefore: before !== undefined, clock }),
    colorRole: registerAfterCompare({ value: group.colorRole, previous: old?.value.colorRole, before: before?.colorRole, hasBefore: before !== undefined, clock }),
    position: registerAfterCompare({ value: group.order, previous: old?.value.position, before: before?.order, hasBefore: before !== undefined, clock }),
  };
  return { id: recordId('group', group.id), kind: 'group', entityId: group.id, value };
}

interface BuildShortcutRecordInput {
  readonly shortcut: Shortcut;
  readonly previous?: SyncRecordRow;
  readonly before?: Shortcut;
  readonly clock: SyncClock;
}

export function buildShortcutRecord(input: BuildShortcutRecordInput): Extract<SyncRecordRow, { kind: 'shortcut' }> {
  const { shortcut, previous, before, clock } = input;
  const old = livePrevious(previous, 'shortcut');
  const value: SyncShortcut = {
    id: shortcut.id,
    title: registerAfterCompare({ value: shortcut.title, previous: old?.value.title, before: before?.title, hasBefore: before !== undefined, clock }),
    url: registerAfterCompare({ value: shortcut.url, previous: old?.value.url, before: before?.url, hasBefore: before !== undefined, clock }),
    placement: registerAfterCompare({ value: { groupId: shortcut.groupId, order: shortcut.order }, previous: old?.value.placement,
      before: before && { groupId: before.groupId, order: before.order }, hasBefore: before !== undefined, clock }),
    icon: registerAfterCompare({ value: shortcut.icon, previous: old?.value.icon, before: before?.icon, hasBefore: before !== undefined, clock }),
  };
  return { id: recordId('shortcut', shortcut.id), kind: 'shortcut', entityId: shortcut.id, value };
}

function registerAfterCompare<T>(input: { readonly value: T; readonly previous?: SyncRegister<T>; readonly before?: T;
  readonly hasBefore: boolean; readonly clock: SyncClock }): SyncRegister<T> {
  const { value, previous, before, hasBefore, clock } = input;
  if (hasBefore && previous && sameValue(value, before)) return previous;
  return clock.register(value, previous);
}

export function buildAssetRecord(asset: MediaAsset, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'asset' }> {
  const old = livePrevious(previous, 'asset');
  const value: Omit<SyncAsset, 'sha256'> = {
    id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height, byteLength: asset.blob.size,
    sourceUrl: clock.register(asset.sourceUrl, old?.value.sourceUrl),
    motion: asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null,
  };
  const row: Extract<SyncRecordRow, { kind: 'asset' }> = { id: recordId('asset', asset.id), kind: 'asset', entityId: asset.id, value };
  return old?.kind === 'asset' && old.sha256 ? { ...row, sha256: old.sha256 } : row;
}

export function buildSettingsRecord(settings: AppSettings, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'settings' }> {
  const old = livePrevious(previous, 'settings');
  const value: SyncSettings = {
    appearance: clock.register(settings.appearance, old?.value.appearance),
    defaultEngineId: clock.register(settings.search.defaultEngineId, old?.value.defaultEngineId),
    layout: clock.register(settings.layout, old?.value.layout),
    clock: clock.register(settings.clock, old?.value.clock),
    searchPreferences: clock.register({ width: settings.search.width, autoFocus: settings.search.autoFocus,
      openTarget: settings.search.openTarget }, old?.value.searchPreferences),
    shortcutPreferences: clock.register(settings.shortcuts, old?.value.shortcutPreferences),
    customEngines: [],
  };
  return { id: recordId('settings', 'app'), kind: 'settings', entityId: 'app', value };
}

export function buildEngineRecord(engine: SearchEngine, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'custom-engine' }> {
  const old = livePrevious(previous, 'custom-engine');
  return { id: recordId('custom-engine', engine.id), kind: 'custom-engine', entityId: engine.id,
    value: clock.register(engine, old?.value) };
}

interface BuildTombstoneInput {
  readonly kind: 'group' | 'shortcut' | 'custom-engine';
  readonly entityId: string;
  readonly previous?: SyncRecordRow;
  readonly clock: SyncClock;
}

export function buildTombstoneRecord(input: BuildTombstoneInput): SyncTombstoneRecordRow {
  const { kind, entityId, previous, clock } = input;
  if (previous?.kind === 'tombstone') return previous;
  const tombstone = clock.tombstone(kind, entityId);
  return { id: recordId(kind, entityId), kind: 'tombstone', entityId, tombstone };
}
