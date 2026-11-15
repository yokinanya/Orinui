import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';

export const HOME_COLUMNS = 2;
export const HOME_ROW_HEIGHT = 80;
export const WIDGET_HEIGHTS = [2, 3, 4] as const;
export type WidgetHeight = typeof WIDGET_HEIGHTS[number];
export interface HomePlacement {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly height: number;
}
export interface TodoItem {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
  readonly order: number;
}
export interface HomeWidget {
  readonly id: string;
  readonly kind: 'note' | 'todo';
  readonly text: string;
  readonly items: readonly TodoItem[];
}
export interface HomeData {
  readonly placements: readonly HomePlacement[];
  readonly widgets: readonly HomeWidget[];
}
export const EMPTY_HOME: HomeData = { placements: [], widgets: [] };
export function homeKey(kind: 'folder' | 'shortcut' | 'widget', id: string): string { return `${kind}:${id}`; }
/** 从格位键还原小组件自身 ID；其他类型返回 null。 */
export function widgetId(key: string): string | null {
  return key.startsWith('widget:') ? key.slice('widget:'.length) : null;
}
export function comparePlacement(a: HomePlacement, b: HomePlacement): number {
  return a.row - b.row || a.column - b.column || (a.id < b.id ? -1 : Number(a.id !== b.id));
}
function validInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function text(value: unknown): string {
  if (typeof value !== 'string') fail('小组件文本格式不正确');
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!result || result.trim() !== result || /[\u0000-\u001f\u007f]/u.test(result)) fail('主页标识不正确');
  return result;
}
export function validatePlacement(value: unknown): HomePlacement {
  const raw = asRecord(value, '格位');
  if (Object.keys(raw).some((key) => !['id', 'column', 'row', 'height'].includes(key))) fail('未知格位字段');
  if (!validInteger(raw.column) || raw.column >= HOME_COLUMNS || !validInteger(raw.row)) fail('格位坐标不正确');
  if (!validInteger(raw.height) || raw.height < 1 || raw.height > WIDGET_HEIGHTS[2]) fail('格位高度不正确');
  if (!Number.isSafeInteger(raw.row + raw.height)) fail('格位超出有效范围');
  return { id: id(raw.id), column: raw.column, row: raw.row, height: raw.height };
}
export function validateTodo(value: unknown): TodoItem {
  const raw = asRecord(value, '待办');
  if (Object.keys(raw).some((key) => !['id', 'text', 'completed', 'order'].includes(key))) fail('未知待办字段');
  if (typeof raw.completed !== 'boolean' || !validInteger(raw.order)) fail('待办状态或顺序不正确');
  return { id: id(raw.id), text: text(raw.text), completed: raw.completed, order: raw.order };
}
export function validateWidget(value: unknown): HomeWidget {
  const raw = asRecord(value, '小组件');
  if (Object.keys(raw).some((key) => !['id', 'kind', 'text', 'items'].includes(key))) fail('未知小组件字段');
  if (raw.kind !== 'note' && raw.kind !== 'todo') fail('不支持的小组件类型');
  if (!Array.isArray(raw.items)) fail('待办列表格式不正确');
  const items = raw.items.map(validateTodo);
  unique(items);
  if (raw.kind === 'note' && items.length) fail('便签不能包含待办');
  return { id: id(raw.id), kind: raw.kind, text: text(raw.text),
    items: items.toSorted((a, b) => a.order - b.order || (a.id < b.id ? -1 : Number(a.id !== b.id))) };
}
function unique(items: readonly { readonly id: string }[]): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail('主页标识重复');
}
export function validateHome(value: unknown): HomeData {
  const raw = asRecord(value, '主页数据');
  if (!Array.isArray(raw.placements) || !Array.isArray(raw.widgets)) fail('主页数据格式不正确');
  const placements = raw.placements.map(validatePlacement);
  const widgets = raw.widgets.map(validateWidget);
  if (Object.keys(raw).some((key) => !['placements', 'widgets'].includes(key))) fail('未知主页数据字段');
  unique(placements); unique(widgets);
  for (const placement of placements) {
    const widget = widgets.find((item) => homeKey('widget', item.id) === placement.id);
    if (!/^(folder|shortcut|widget):.+/u.test(placement.id)) fail('格位实体类型不正确');
    if (placement.id.startsWith('widget:') && !widget) fail('小组件格位引用不存在');
    if (widget ? !WIDGET_HEIGHTS.includes(placement.height as WidgetHeight) : placement.height !== 1) fail('条目高度不正确');
  }
  return { placements: placements.toSorted(comparePlacement), widgets: widgets.toSorted((a, b) => a.id < b.id ? -1 : Number(a.id !== b.id)) };
}
function overlaps(a: HomePlacement, b: HomePlacement): boolean {
  return a.column === b.column && a.row < b.row + b.height && b.row < a.row + a.height;
}
/** Only occupants actually intersecting the moving obstacle are pushed; unrelated holes survive. */
export function placeHome(items: readonly HomePlacement[], target: HomePlacement): HomePlacement[] {
  const moving = validatePlacement(target);
  const column = items.filter((item) => item.id !== target.id && item.column === target.column).toSorted(comparePlacement);
  const other = items.filter((item) => item.id !== target.id && item.column !== target.column);
  let boundary = moving.row + moving.height;
  const pushed = column.map((item) => {
    if (item.row + item.height <= moving.row || item.row >= boundary) return item;
    const next = validatePlacement({ ...item, row: boundary });
    boundary = next.row + next.height;
    return next;
  });
  return [...other, moving, ...pushed].toSorted(comparePlacement);
}
export function firstHomeSpace(items: readonly HomePlacement[], input: { readonly id: string; readonly height: number }): HomePlacement {
  const end = items.reduce((max, item) => Math.max(max, item.row + item.height), 0);
  for (let row = 0; row <= end; row += 1) {
    for (let column = 0; column < HOME_COLUMNS; column += 1) {
      const candidate = { ...input, row, column };
      if (!items.some((item) => overlaps(item, candidate))) return validatePlacement(candidate);
    }
  }
  fail('无法分配主页格位');
}
export function assertHomeDisjoint(items: readonly HomePlacement[]): void {
  for (const [index, item] of items.entries()) {
    if (items.slice(index + 1).some((other) => overlaps(item, other))) fail('主页格位重叠');
  }
}
export function compactHome(ids: readonly string[]): HomePlacement[] {
  return ids.map((id, index) => ({ id, row: Math.floor(index / HOME_COLUMNS), column: index % HOME_COLUMNS, height: 1 }));
}
export function reconcileHome(input: { readonly home: HomeData; readonly folders: readonly { readonly id: string; readonly order: number; readonly parentId?: string | null }[];
  readonly shortcuts: readonly { readonly id: string; readonly order: number; readonly folderId: string | null }[] }): HomeData {
  const ordered = (items: readonly { readonly id: string; readonly order: number }[]) => items.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  // 只有顶层（parentId 为 null 或旧数据缺字段）文件夹进入主页格位；嵌套文件夹留在父容器内。
  const rootFolders = input.folders.filter(({ parentId }) => (parentId ?? null) === null);
  const ids = [...ordered(rootFolders).map(({ id }) => homeKey('folder', id)),
    ...ordered(input.shortcuts.filter(({ folderId }) => folderId === null)).map(({ id }) => homeKey('shortcut', id)),
    ...input.home.widgets.map(({ id }) => homeKey('widget', id))];
  let placements = input.home.placements.filter(({ id }) => ids.includes(id));
  for (const id of ids) {
    if (placements.some((item) => item.id === id)) continue;
    placements = [...placements, firstHomeSpace(placements, { id, height: id.startsWith('widget:') ? WIDGET_HEIGHTS[1] : 1 })];
  }
  return { ...input.home, placements: placements.toSorted(comparePlacement) };
}
