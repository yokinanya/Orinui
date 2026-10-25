import { EMPTY_HOME, comparePlacement, placeHome, validateHome, type HomeData, type HomePlacement, type HomeWidget } from '@/domain/home';
import { fail } from '@/domain/errors';
import type { SyncRegister } from '@/domain/sync/types';
import { nextSyncCounter } from '@/domain/sync/version';

export type SyncHome = Readonly<Record<string, SyncRegister<unknown>>>;
const key = (parts: readonly string[]) => JSON.stringify(parts);
export function homeFields(home: HomeData): Readonly<Record<string, unknown>> {
  const entries: [string, unknown][] = home.placements.map((item) => [key(['placement', item.id]), item]);
  for (const widget of home.widgets) {
    entries.push([key(['widget', widget.id, 'kind']), widget.kind], [key(['widget', widget.id, 'text']), widget.text]);
    for (const item of widget.items) {
      entries.push([key(['todo', widget.id, item.id, 'text']), item.text],
        [key(['todo', widget.id, item.id, 'completed']), item.completed], [key(['todo', widget.id, item.id, 'order']), item.order]);
    }
  }
  return Object.fromEntries(entries);
}
export function buildSyncHome(input: { readonly home: HomeData; readonly previous?: SyncHome;
  readonly register: (value: unknown, previous?: SyncRegister<unknown>) => SyncRegister<unknown> }): SyncHome {
  const fields = homeFields(input.home);
  const keys = [...new Set([...Object.keys(fields), ...Object.keys(input.previous ?? {})])].sort();
  return Object.fromEntries(keys.map((id) => {
    const previous = input.previous?.[id];
    const path = parts(id);
    const permanent = path[0] === 'widget' && path[2] === 'kind' || path[0] === 'todo' && path[3] === 'text';
    if (permanent && previous?.value === null && Object.hasOwn(fields, id)) fail('已同步删除的小组件或待办标识不能复用');
    return [id, input.register(Object.hasOwn(fields, id) ? fields[id] : null, previous)];
  }));
}
function parts(value: string): [string, string, ...string[]] {
  let result: unknown;
  try { result = JSON.parse(value); } catch { fail('主页同步字段标识不正确'); }
  if (!Array.isArray(result) || result.length < 2 || !result.every((part) => typeof part === 'string' && part.trim() === part && part.length > 0 && !/[\u0000-\u001f\u007f]/u.test(part))) fail('主页同步字段标识不正确');
  return result as [string, string, ...string[]];
}
export function materializeHome(fields: SyncHome = {}): HomeData {
  const placements: HomePlacement[] = [];
  const widgets = new Map<string, Record<string, unknown>>();
  const todos = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [id, register] of Object.entries(fields)) {
    const [kind, entityId, field, todoField] = parts(id);
    if (register.value === null) continue;
    if (kind === 'placement') { placements.push(register.value as HomePlacement); continue; }
    if (kind === 'widget') {
      const widget = widgets.get(entityId) ?? { id: entityId };
      widgets.set(entityId, { ...widget, [String(field)]: register.value });
      continue;
    }
    if (kind !== 'todo') fail('未知主页同步字段');
    const items = todos.get(entityId) ?? new Map();
    if (!field || !todoField) fail('待办同步字段不完整');
    items.set(field, { ...items.get(field), id: field, [todoField]: register.value });
    todos.set(entityId, items);
  }
  const liveWidgets = [...widgets.values()].filter((widget) => widget.kind !== undefined).map((widget) => ({ ...widget,
    items: [...(todos.get(String(widget.id))?.values() ?? [])].filter((item) => item.text !== undefined) }));
  const alive = new Set([...widgets.values()].filter((widget) => widget.kind !== undefined).map((widget) => `widget:${String(widget.id)}`));
  return validateHome({ placements: placements.filter((item) => !item.id.startsWith('widget:') || alive.has(item.id)),
    widgets: liveWidgets as unknown as HomeWidget[] });
}
export function validateSyncHome(value: unknown): SyncHome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('主页同步字段格式不正确');
  const fields = value as SyncHome;
  for (const [id, register] of Object.entries(fields)) {
    const path = parts(id);
    if (!register || Object.keys(register).some((field) => !['value', 'clock', 'deviceId'].includes(field)) || !Object.hasOwn(register, 'value')) fail('主页同步寄存器格式不正确');
    if (!Number.isSafeInteger(register.clock) || register.clock < 0 || typeof register.deviceId !== 'string' || register.deviceId.trim() !== register.deviceId || !register.deviceId) fail('主页同步逻辑版本不正确');
    if (path[0] === 'placement' && path.length === 2) continue;
    if (path[0] === 'widget' && path.length === 3 && ['kind', 'text'].includes(String(path[2]))) continue;
    if (path[0] === 'todo' && path.length === 4 && ['text', 'completed', 'order'].includes(String(path[3]))) continue;
    fail('未知主页同步字段');
  }
  materializeHome(fields);
  return fields;
}
function choose(a: SyncRegister<unknown>, b: SyncRegister<unknown>): SyncRegister<unknown> {
  if (a.clock === b.clock && a.deviceId === b.deviceId && JSON.stringify(a.value) !== JSON.stringify(b.value)) fail('同一主页字段逻辑版本包含不同内容');
  return a.clock > b.clock || (a.clock === b.clock && a.deviceId >= b.deviceId) ? a : b;
}
export function mergeSyncHome(inputs: readonly SyncHome[]): SyncHome {
  const fields = new Map<string, SyncRegister<unknown>>();
  for (const input of inputs) for (const [id, register] of Object.entries(input)) {
    const previous = fields.get(id);
    const path = parts(id);
    const deletionField = path[0] === 'widget' && path[2] === 'kind' || path[0] === 'todo' && path[3] === 'text';
    if (previous && deletionField && (previous.value === null || register.value === null)) {
      fields.set(id, previous.value === null && register.value === null ? choose(previous, register) : previous.value === null ? previous : register);
      continue;
    }
    fields.set(id, previous ? choose(previous, register) : register);
  }
  return Object.fromEntries([...fields].sort(([a], [b]) => a.localeCompare(b)));
}
export function resolveSyncHome(input: { readonly fields: SyncHome; readonly deviceId: string; readonly clock: number }): SyncHome {
  const home = materializeHome(input.fields);
  let placements: HomePlacement[] = [];
  // Stable priority independent of input traversal and device-local randomness.
  for (const item of home.placements.toSorted(comparePlacement).reverse()) placements = placeHome(placements, item);
  const fields = { ...input.fields };
  let clock = input.clock;
  for (const item of placements) {
    const id = key(['placement', item.id]);
    if (JSON.stringify(fields[id]?.value) === JSON.stringify(item)) continue;
    clock = nextSyncCounter(clock);
    fields[id] = { value: item, clock, deviceId: input.deviceId };
  }
  return fields;
}
export function seedHome(home: HomeData = EMPTY_HOME, deviceId: string): SyncHome {
  return buildSyncHome({ home, register: (value) => ({ value, clock: 0, deviceId }) });
}
