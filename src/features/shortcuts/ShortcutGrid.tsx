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
import type { OpenTarget } from '@/domain/settings';
import { AddShortcutTile } from '@/features/shortcuts/AddShortcutTile';
import { ShortcutActionsButton, ShortcutContextMenu } from '@/features/shortcuts/ShortcutActionsMenu';
import { ShortcutTile } from '@/features/shortcuts/ShortcutTile';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface SortableShortcutProps {
  shortcut: Shortcut;
  editing: boolean;
  onEdit: (shortcut: Shortcut) => void;
  showNames: boolean;
  openTarget: OpenTarget;
}

function SortableShortcut({ shortcut, editing, onEdit, showNames, openTarget }: SortableShortcutProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shortcut.id,
    disabled: !editing,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative min-w-0', isDragging && 'z-10 opacity-90')}
    >
      <ShortcutContextMenu shortcut={shortcut} onEdit={onEdit}>
        {/* 拖动属性挂在格子内层：li 保持列表语义，操作按钮作为兄弟节点不会嵌套在按钮里 */}
        <div className="home-readable-focus outline-none" {...(editing ? { ...attributes, ...listeners } : {})}>
          <ShortcutTile shortcut={shortcut} editing={editing} showName={showNames || editing} openTarget={openTarget} />
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
 * 使用自适应网格，按用户设置的最大列数限制宽屏列数，窄屏随可用宽度减少。
 * 网站数量不足以填满一行时保持居中。
 *
 * 编辑模式下整格可拖动（需要移动 8px 才算拖动，点击仍然有效），
 * 键盘用空格拿起、方向键移动、空格放下，右键菜单另提供上移下移。
 */
export function ShortcutGrid({ shortcuts, editing, onEdit, onAdd }: ShortcutGridProps) {
  const { reorderShortcut, settings } = useData();
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
        <ul className="shortcut-grid mx-auto w-full" style={{
          maxWidth: `min(100%, calc(${settings.layout.columns} * 6rem + (${settings.layout.columns} - 1) * 1rem))`,
        }}>
          {shortcuts.map((shortcut) => (
            <SortableShortcut key={shortcut.id} shortcut={shortcut} editing={editing} onEdit={onEdit}
              showNames={settings.shortcuts.showNames} openTarget={settings.shortcuts.openTarget} />
          ))}
          {editing && (
            <li className="min-w-0">
              <AddShortcutTile onClick={onAdd} />
            </li>
          )}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
