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
import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import type { OpenTarget } from '@/domain/settings';
import { FolderContextMenu, FolderPositionItems } from '@/features/folders/FolderActionsMenu';
import { FolderTile } from '@/features/folders/FolderTile';
import { AddShortcutTile } from '@/features/shortcuts/AddShortcutTile';
import { ShortcutActionsButton, ShortcutContextMenu } from '@/features/shortcuts/ShortcutActionsMenu';
import { ShortcutTile } from '@/features/shortcuts/ShortcutTile';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

const TILE_MIN_WIDTH_REM = 6;
const DRAG_ACTIVATION_DISTANCE = 8;

/** 最多使用所选列数；空间不足时自动减少列数，继续向下排列。 */
function shortcutColumns(columns: number): string {
  const track = `max(min(100%, ${TILE_MIN_WIDTH_REM}rem), calc((100% - (${columns} - 1) * var(--shortcut-grid-gap)) / ${columns}))`;
  return `repeat(auto-fill, minmax(${track}, 1fr))`;
}

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

interface SortableFolderProps {
  readonly folder: Folder;
  readonly editing: boolean;
  readonly onOpen: (folderId: string) => void;
  readonly onRename: (folder: Folder) => void;
  readonly onDelete: (folder: Folder) => void;
}

/** 文件夹格子：普通模式点开弹层，编辑模式可拖动排序并通过操作按钮改名或删除。 */
function SortableFolder({ folder, editing, onOpen, onRename, onDelete }: SortableFolderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder:${folder.id}`,
    disabled: !editing,
  });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative min-w-0', isDragging && 'z-10 opacity-90')}>
      <FolderContextMenu folder={folder} onOpen={onOpen} onRename={onRename} onDelete={onDelete}>
        <div {...(editing ? { ...attributes, ...listeners, role: 'group', tabIndex: -1 } : {})}>
          <FolderTile name={folder.name} editing={editing} onClick={() => onOpen(folder.id)} />
        </div>
      </FolderContextMenu>
      {editing && <FolderActionsButton folder={folder} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />}
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
        <FolderPositionItems folder={folder} />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(folder)}><Trash2Icon />删除文件夹</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ShortcutGridProps {
  readonly shortcuts: Shortcut[];
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
 * 主页网格。
 *
 * 文件夹与网站共用同一套网格轨道：文件夹排在网站之前，编辑模式下可拖动文件夹调整顺序。
 * 使用自适应网格，按用户设置的最大列数限制宽屏列数，窄屏随可用宽度减少。
 *
 * 编辑模式下整格可拖动（需要移动 8px 才算拖动，点击仍然有效），
 * 键盘通过对象菜单上移、下移，拖动容器不占用 Tab 停靠点。
 */
export function ShortcutGrid(props: ShortcutGridProps) {
  const { shortcuts, folders, onShortcutsChanged, editing, onEdit, onAdd, onOpenFolder, onEditFolder, onDeleteFolder, alignment } = props;
  const { reorderShortcut, reorderFolder, settings } = useData();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = createDragEndHandler({ folders, shortcuts, reorderFolder, reorderShortcut, onShortcutsChanged });

  const items = [
    ...folders.map((folder) => `folder:${folder.id}`),
    ...shortcuts.map((shortcut) => `shortcut:${shortcut.id}`),
  ];

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div data-shortcut-frame className={cn('min-w-0 w-full max-w-full', alignment === 'center' ? 'mx-auto' : 'mx-0')}>
          <ul data-shortcut-alignment={alignment} className="shortcut-grid w-full"
            style={{ gridTemplateColumns: shortcutColumns(settings.layout.columns) }}>
            {folders.map((folder) => (
              <SortableFolder key={folder.id} folder={folder} editing={editing} onOpen={onOpenFolder}
                onRename={onEditFolder} onDelete={onDeleteFolder} />
            ))}
            {shortcuts.map((shortcut) => (
              <SortableShortcut key={shortcut.id} shortcut={shortcut} editing={editing} showActions={props.showActions ?? editing} onEdit={onEdit} onChanged={onShortcutsChanged}
                containerShortcuts={shortcuts} showNames={settings.shortcuts.showNames} openTarget={settings.shortcuts.openTarget} />
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
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly reorderFolder: (id: string, index: number) => Promise<void>;
  readonly reorderShortcut: (id: string, index: number) => Promise<void>;
  readonly onShortcutsChanged: () => void;
}

function createDragEndHandler({ folders, shortcuts, reorderFolder, reorderShortcut, onShortcutsChanged }: DragHandlerOptions) {
  // 拖动落点按混合列表的索引处理；跨类型拖动只重排目标类型，不改变网站的容器归属。
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const orderedFolderIds = folders.map((folder) => `folder:${folder.id}`);
    const orderedShortcutIds = shortcuts.map((shortcut) => `shortcut:${shortcut.id}`);
    const activeFolderIndex = orderedFolderIds.indexOf(activeId);
    const activeShortcutIndex = orderedShortcutIds.indexOf(activeId);
    const overFolderIndex = orderedFolderIds.indexOf(overId);
    const overShortcutIndex = orderedShortcutIds.indexOf(overId);

    if (activeFolderIndex >= 0 && overFolderIndex >= 0) {
      void reorderFolder(folders[activeFolderIndex]!.id, overFolderIndex)
        .then(onShortcutsChanged).catch(notifyError);
      return;
    }
    if (activeShortcutIndex >= 0 && overShortcutIndex >= 0) {
      void reorderShortcut(shortcuts[activeShortcutIndex]!.id, overShortcutIndex)
        .then(onShortcutsChanged).catch(notifyError);
    }
  };

  return handleDragEnd;
}
