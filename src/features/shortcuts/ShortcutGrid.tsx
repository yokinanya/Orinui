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

import { useData } from '@/app/data-context';
import type { Shortcut } from '@/domain/shortcut';
import { AddShortcutTile } from '@/features/shortcuts/AddShortcutTile';
import { ShortcutActionsButton, ShortcutContextMenu } from '@/features/shortcuts/ShortcutActionsMenu';
import { ShortcutTile } from '@/features/shortcuts/ShortcutTile';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface SortableShortcutProps {
  shortcut: Shortcut;
  editing: boolean;
  onEdit: (shortcut: Shortcut) => void;
}

function SortableShortcut({ shortcut, editing, onEdit }: SortableShortcutProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shortcut.id,
    disabled: !editing,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative w-[5.5rem] md:w-24', isDragging && 'z-10 opacity-90')}
    >
      <ShortcutContextMenu shortcut={shortcut} onEdit={onEdit}>
        {/* 拖动属性挂在格子内层：li 保持列表语义，操作按钮作为兄弟节点不会嵌套在按钮里 */}
        <div {...(editing ? { ...attributes, ...listeners } : {})}>
          <ShortcutTile shortcut={shortcut} editing={editing} />
        </div>
      </ShortcutContextMenu>
      {editing && (
        <ShortcutActionsButton
          shortcut={shortcut}
          onEdit={onEdit}
          className="absolute top-0 right-0"
        />
      )}
    </li>
  );
}

interface ShortcutGridProps {
  shortcuts: Shortcut[];
  editing: boolean;
  onEdit: (shortcut: Shortcut) => void;
  onAdd: () => void;
}

/**
 * 网站网格。
 *
 * 视觉规格：宽屏最多 6 列，窄窗口自适应减少列数与间距。
 * 使用固定宽度的换行布局而不是等分网格：网站数量不足以填满一行时整行保持居中，
 * 不会像等分网格那样把前几个网站挤到最左侧。
 * 容器宽度上限 41rem 约等于 6 个网站宽度加 5 个间距，形成 6 列硬上限。
 *
 * 编辑模式下整格可拖动（需要移动 8px 才算拖动，点击仍然有效），
 * 键盘用空格拿起、方向键移动、空格放下，右键菜单另提供上移下移。
 */
export function ShortcutGrid({ shortcuts, editing, onEdit, onAdd }: ShortcutGridProps) {
  const { reorderShortcut } = useData();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const index = shortcuts.findIndex((item) => item.id === String(over.id));
    if (index < 0) return;

    void reorderShortcut(String(active.id), index).catch(notifyError);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={shortcuts.map((shortcut) => shortcut.id)} strategy={rectSortingStrategy}>
        <ul className="mx-auto flex w-full max-w-[41rem] flex-wrap items-start justify-center gap-2 md:gap-4">
          {shortcuts.map((shortcut) => (
            <SortableShortcut key={shortcut.id} shortcut={shortcut} editing={editing} onEdit={onEdit} />
          ))}
          {editing && (
            <li className="w-[5.5rem] md:w-24">
              <AddShortcutTile onClick={onAdd} />
            </li>
          )}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
