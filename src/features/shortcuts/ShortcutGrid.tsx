import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { FolderOpenIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import type { OpenTarget } from '@/domain/settings';
import { FolderContextMenu } from '@/features/folders/FolderActionsMenu';
import { FolderTile } from '@/features/folders/FolderTile';
import { AddShortcutTile } from '@/features/shortcuts/AddShortcutTile';
import { ShortcutActionsButton, ShortcutContextMenu } from '@/features/shortcuts/ShortcutActionsMenu';
import { ShortcutTile } from '@/features/shortcuts/ShortcutTile';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

const DRAG_ACTIVATION_DISTANCE = 8;

interface SortableShortcutProps {
  shortcut: Shortcut;
  editing: boolean;
  onEdit: (shortcut: Shortcut) => void;
  onChanged: () => void;
  containerShortcuts: readonly Shortcut[];
  showNames: boolean;
  showActions: boolean;
  openTarget: OpenTarget;
}

function SortableShortcut({ shortcut, editing, onEdit, onChanged, containerShortcuts, showNames, showActions, openTarget }: SortableShortcutProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `shortcut:${shortcut.id}`,
    disabled: !editing,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative min-w-0', isDragging && 'z-10 opacity-90')}
    >
      <ShortcutContextMenu shortcut={shortcut} onEdit={onEdit} containerShortcuts={containerShortcuts} onChanged={onChanged}>
        {/* 拖动属性挂在格子内层：li 保持列表语义，操作按钮作为兄弟节点不会嵌套在按钮里。
            拖动入口不放进 Tab 序列，否则编辑模式下空网格的第一个停靠点是一个无名称的可拖动区域；
            键盘仍可用菜单里的上移、下移排序。 */}
        <div {...(editing ? { ...attributes, ...listeners, tabIndex: -1 } : {})}>
          <ShortcutTile shortcut={shortcut} editing={editing} showName={showNames || editing} openTarget={openTarget} />
        </div>
      </ShortcutContextMenu>
      {showActions && (
        <ShortcutActionsButton
          shortcut={shortcut}
          onEdit={onEdit}
          containerShortcuts={containerShortcuts}
          onChanged={onChanged}
          className="absolute top-0 right-0"
        />
      )}
    </li>
  );
}

interface StaticFolderProps {
  readonly folder: Folder;
  readonly editing: boolean;
  readonly showActions: boolean;
  readonly onOpen: (folderId: string) => void;
  readonly onRename: (folder: Folder) => void;
  readonly onDelete: (folder: Folder) => void;
}

/**
 * 文件夹格子。
 *
 * 自有文件夹可任意嵌套，但不能移动、改父或同层重排，因此这里始终是静态块：
 * 不接入 sortable、不提供上移/下移，编辑模式下也不会变成拖拽手柄。
 */
function StaticFolder({ folder, editing, showActions, onOpen, onRename, onDelete }: StaticFolderProps) {
  return (
    <li className="relative min-w-0">
      <FolderContextMenu folder={folder} onOpen={onOpen} onRename={onRename} onDelete={onDelete}>
        <FolderTile folderId={folder.id} name={folder.name} editing={editing} onClick={() => onOpen(folder.id)} />
      </FolderContextMenu>
      {(editing || showActions) && <FolderActionsButton folder={folder} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />}
    </li>
  );
}

function FolderActionsButton({ folder, onOpen, onRename, onDelete }: {
  readonly folder: Folder;
  readonly onOpen: (folderId: string) => void;
  readonly onRename: (folder: Folder) => void;
  readonly onDelete: (folder: Folder) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${folder.name} 的操作`}
          className="home-readable-control home-readable-focus absolute top-0 right-0" />
      }>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onOpen(folder.id)}><FolderOpenIcon />打开文件夹</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(folder)}><PencilIcon />重命名</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(folder)}><Trash2Icon />删除文件夹</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ShortcutGridProps {
  readonly shortcuts: Shortcut[];
  /** 当前层的直接子文件夹；主页只传顶层文件夹。 */
  readonly folders: readonly Folder[];
  readonly editing: boolean;
  readonly showActions?: boolean;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly onAdd: () => void;
  readonly onOpenFolder: (folderId: string) => void;
  readonly onEditFolder: (folder: Folder) => void;
  readonly onDeleteFolder: (folder: Folder) => void;
  readonly onShortcutsChanged: () => void;
  readonly alignment: 'center' | 'start';
}

/**
 * 网站与当前层文件夹共用的自适应网格。
 *
 * 文件夹按领域顺序排在网站之前，位置固定；只有网站在编辑模式下可拖动或键盘移动。
 * 网格按可用宽度减少列数，窄屏继续向下排列。
 */
export function ShortcutGrid(props: ShortcutGridProps) {
  const { shortcuts, folders, onShortcutsChanged, editing, onEdit, onAdd, onOpenFolder, onEditFolder, onDeleteFolder, alignment } = props;
  const { reorderShortcut, settings } = useData();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = createDragEndHandler({ shortcuts, reorderShortcut, onShortcutsChanged });
  const items = shortcuts.map((shortcut) => `shortcut:${shortcut.id}`);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div data-shortcut-frame className={cn('min-w-0 w-full max-w-full', alignment === 'center' ? 'mx-auto' : 'mx-0')}>
          <ul data-shortcut-alignment={alignment} className="shortcut-grid w-full"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {folders.map((folder) => (
              <StaticFolder key={folder.id} folder={folder} editing={editing} showActions={props.showActions ?? editing}
                onOpen={onOpenFolder} onRename={onEditFolder} onDelete={onDeleteFolder} />
            ))}
            {shortcuts.map((shortcut) => (
              <SortableShortcut key={shortcut.id} shortcut={shortcut} editing={editing} showActions={props.showActions ?? editing}
                onEdit={onEdit} onChanged={onShortcutsChanged} containerShortcuts={shortcuts}
                showNames={settings.shortcuts.showNames} openTarget={settings.shortcuts.openTarget} />
            ))}
            {editing && (
              <li className="min-w-0">
                <AddShortcutTile onClick={onAdd} />
              </li>
            )}
          </ul>
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface DragHandlerOptions {
  readonly shortcuts: readonly Shortcut[];
  readonly reorderShortcut: (id: string, index: number) => Promise<void>;
  readonly onShortcutsChanged: () => void;
}

/** 只处理网站排序；文件夹不可拖动，也不存在跨容器移动。 */
function createDragEndHandler({ shortcuts, reorderShortcut, onShortcutsChanged }: DragHandlerOptions) {
  return ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeIndex = shortcuts.findIndex((shortcut) => `shortcut:${shortcut.id}` === String(active.id));
    const overIndex = shortcuts.findIndex((shortcut) => `shortcut:${shortcut.id}` === String(over.id));
    if (activeIndex < 0 || overIndex < 0) return;
    void reorderShortcut(shortcuts[activeIndex]!.id, overIndex).then(onShortcutsChanged).catch(notifyError);
  };
}
