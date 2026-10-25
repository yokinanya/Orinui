import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { revealHomeItem } from '@/platform/home-focus';
import { useHomeKeyboard } from '@/features/layout/use-home-keyboard';
import { useWidgetResize, type WidgetResize } from '@/features/layout/use-widget-resize';
import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent } from '@dnd-kit/core';
import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { EMPTY_HOME, HOME_COLUMNS, HOME_ROW_HEIGHT, homeKey, reconcileHome, widgetId,
  type HomePlacement, type HomeWidget, type WidgetHeight } from '@/domain/home';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { FolderTile } from '@/features/folders/FolderTile';
import { FolderContextMenu } from '@/features/folders/FolderActionsMenu';
import { ShortcutTile } from '@/features/shortcuts/ShortcutTile';
import { ShortcutActionsButton, ShortcutContextMenu } from '@/features/shortcuts/ShortcutActionsMenu';
import { Widget } from '@/features/layout/Widget';
import { cn } from '@/lib/utils';
import { notifyError } from '@/lib/notify';

const DRAG_DISTANCE = 8;
/** 卡片底部留白：这段空白是拖拽起点，避免内容贴边。 */
const DRAG_TRAY_CLASS = 'pb-4';

interface HomeGridProps {
  readonly editing: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly onOpenFolder: (id: string) => void;
  readonly onRenameFolder: (folder: Folder) => void;
  readonly onDeleteFolder: (folder: Folder) => void;
  readonly pendingHomeItem: string | null;
}
export function HomeGrid(props: HomeGridProps) {
  const { settings, folders, shortcuts, moveHomeItem, updateWidgetHeight } = useData();
  const home = reconcileHome({ home: settings.home ?? EMPTY_HOME, folders, shortcuts });
  const keyboard = useHomeKeyboard(moveHomeItem);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }));
  const end = home.placements.reduce((max, item) => Math.max(max, item.row + item.height), 0);
  const rows = end + (props.editing ? 1 : 0);
  const drop = (event: DragEndEvent) => {
    const placement = home.placements.find(({ id }) => id === event.active.id);
    const target = event.over?.data.current;
      if (placement && target) void moveHomeItem({ ...placement, row: target.row, column: target.column }).catch(notifyError);
  };
  return <div data-shortcut-frame className="w-full">
    {!props.editing && home.placements.length === 0 && <Button variant="secondary" data-home-empty onClick={props.onAdd}>添加第一个网站</Button>}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={drop}>
      <div className="home-grid relative grid gap-x-6 [overflow-anchor:none]" data-home-grid style={{ gridTemplateColumns: `repeat(${HOME_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: HOME_ROW_HEIGHT }}>
        {props.editing && Array.from({ length: rows * HOME_COLUMNS }, (_, index) => <GridCell key={index} row={Math.floor(index / HOME_COLUMNS)}
          column={index % HOME_COLUMNS} selected={keyboard.target?.row === Math.floor(index / HOME_COLUMNS) && keyboard.target.column === index % HOME_COLUMNS} />)}
        {home.placements.map((placement) => <GridItem key={placement.id} placement={placement} editing={props.editing} reveal={props.pendingHomeItem === placement.id}
                  onKeyDown={(event) => keyboard.handle(event, placement)}
                  resize={(height) => {
            const id = widgetId(placement.id);
            if (id) void updateWidgetHeight(id, height).catch(notifyError);
          }}>
          <HomeItem id={placement.id} props={props} widgets={home.widgets} />
        </GridItem>)}
      </div>
    </DndContext>
    <p className="sr-only" role="status">{keyboard.message}</p>
  </div>;
}
function HomeItem({ id, props, widgets }: { readonly id: string; readonly props: HomeGridProps; readonly widgets: readonly HomeWidget[] }) {
  const { folders, shortcuts, settings } = useData();
  const widget = widgets.find((item) => homeKey('widget', item.id) === id);
  if (widget) return <Widget widget={widget} editing={props.editing} />;
  const folder = folders.find((item) => homeKey('folder', item.id) === id);
  if (folder) return <FolderContextMenu folder={folder} onOpen={props.onOpenFolder} onRename={props.onRenameFolder} onDelete={props.onDeleteFolder}>
    <FolderTile name={folder.name} editing={props.editing} onClick={() => props.onOpenFolder(folder.id)} /></FolderContextMenu>;
  const shortcut = shortcuts.find((item) => homeKey('shortcut', item.id) === id);
  if (!shortcut) return null;
  return <ShortcutContextMenu shortcut={shortcut} onEdit={props.onEdit} containerShortcuts={shortcuts} onChanged={() => undefined}>
    <div className="relative"><ShortcutTile shortcut={shortcut} editing={props.editing} showName openTarget={settings.shortcuts.openTarget} />
      {props.editing && <ShortcutActionsButton shortcut={shortcut} onEdit={props.onEdit} containerShortcuts={shortcuts} onChanged={() => undefined}
        className="absolute top-0 right-0" />}</div>
  </ShortcutContextMenu>;
}
// 覆盖格位在容器内按 DOM 顺序排在前，但不参与鼠标命中，避免挡住组件内的按钮与输入。
function GridCell({ row, column, selected }: { readonly row: number; readonly column: number; readonly selected: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${row}:${column}`, data: { row, column } });
  return <div ref={setNodeRef} aria-hidden="true" data-home-cell={`${row}:${column}`}
    className={cn('rounded-xl border border-dashed border-border', selected && 'ring-2 ring-ring')}
    data-over={isOver} style={{ gridRow: row + 1, gridColumn: column + 1, zIndex: 0 }} />;
}
interface GridItemProps {
  readonly placement: HomePlacement;
  readonly editing: boolean;
  readonly children: ReactNode;
  readonly resize: (height: number) => void;
  readonly reveal: boolean;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** 右下角调高抓手：直接拖动改行数，占位不遮内容。 */
function ResizeHandle({ height, handle }: { readonly height: number; readonly handle: WidgetResize }) {
  return <div data-home-resize aria-hidden="true" data-hit
    className="home-resize-handle absolute right-0 bottom-0 grid size-5 cursor-ns-resize touch-none place-items-center text-muted-foreground hover:text-foreground"
    data-resizing={handle.dragging} title={`拖拽调整高度，当前 ${height} 行`}
    onPointerDown={handle.begin} onPointerMove={handle.move} onPointerUp={handle.end} onPointerCancel={handle.end}>
    <span className="block size-2 rounded-sm border border-current border-t-0 border-l-0 opacity-70" />
  </div>;
}

function GridItem({ placement, editing, children, resize, reveal, onKeyDown }: GridItemProps) {
  const element = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (reveal && element.current) revealHomeItem(element.current); }, [reveal]);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: placement.id, disabled: !editing });
  const [liveHeight, setLiveHeight] = useState<number>(placement.height);
  const resizing = useRef(false);
  useEffect(() => { if (!resizing.current) setLiveHeight(placement.height); }, [placement.height]);
  const isWidget = placement.id.startsWith('widget:');
  const resizable = isWidget && editing;
  const handle = useWidgetResize({
    height: placement.height,
    preview: (next) => { resizing.current = true; setLiveHeight(next); },
    commit: (next) => { resizing.current = false; resize(next); },
  });
  // 编辑模式下整张卡片都是拖拽手柄。落点在控件上时由控件自己处理，卡片不启动拖动。
  const dragProps = editing ? { ...attributes, ...listeners } : {};
  return <div data-home-item={placement.id} data-home-row={placement.row} data-home-column={placement.column}
    data-home-height={liveHeight} ref={(node) => { element.current = node; setNodeRef(node); }} data-dragging={isDragging}
    className={cn('relative min-h-0 min-w-0', editing && 'cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring')}
    style={{ gridColumn: placement.column + 1, gridRow: `${placement.row + 1} / span ${liveHeight}`, zIndex: 1 }}
    {...dragProps} onKeyDown={editing ? onKeyDown : undefined}
    onPointerDown={(event) => {
      const target = event.target as Element;
      if (target.closest('button:not([data-folder-tile]), input, textarea, select, a, [data-hit], [role="checkbox"], [contenteditable="true"]')) return;
      listeners?.onPointerDown?.(event);
    }}>
    <div className={cn('h-full min-h-0 min-w-0', editing && DRAG_TRAY_CLASS)}>{children}</div>
    {resizable && <ResizeHandle height={liveHeight} handle={handle} />}
  </div>;
}
