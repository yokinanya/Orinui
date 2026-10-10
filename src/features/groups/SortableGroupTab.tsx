import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';

import type { Group } from '@/domain/group';
import { GroupActionsButton, GroupContextMenu } from '@/features/groups/GroupActionsMenu';
import { DeleteGroupDialog, RenameGroupDialog } from '@/features/groups/GroupDialogs';
import { cn } from '@/lib/utils';

interface SortableGroupTabProps {
  group: Group;
  index: number;
  total: number;
  active: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
}

/**
 * 单个分组标签。
 *
 * 视觉规格：紧凑文本标签，当前项用轻柔底色强调；组多时横向滚动。
 *
 * 编辑模式下「⋯」按钮与标签同在一个胶囊里，而不是单独浮在标签之间：操作入口与被
 * 操作的分组在视觉上属于同一个整体。
 *
 * 拖动属性直接挂在标签按钮上：标签在编辑模式下既是可拖动项也是切换分组的入口。
 * 拆成「外层拖动容器 + 内层按钮」会让一个标签出现两个 Tab 停靠点，并形成按钮套按钮。
 */
export function SortableGroupTab({
  group,
  index,
  total,
  active,
  editing,
  onSelect,
}: SortableGroupTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled: !editing,
  });
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const openRename = () => setRenaming(true);
  const openRemove = () => setRemoving(true);

  const label = (
    <button
      type="button"
      {...(editing ? { ...attributes, ...listeners } : {})}
      onClick={() => onSelect(group.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'text-glass-foreground' : 'text-glass-foreground-muted',
        !editing && active && 'bg-glass',
        !editing && !active && 'hover:bg-glass/60 hover:text-glass-foreground',
      )}
    >
      {group.name}
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center', isDragging && 'z-10 opacity-90')}
    >
      <GroupContextMenu
        group={group}
        index={index}
        total={total}
        onRename={openRename}
        onDelete={openRemove}
      >
        {editing ? (
          <div
            className={cn(
              'flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-1 ring-1 ring-glass-border',
              active ? 'bg-glass' : 'bg-glass/30',
            )}
          >
            {label}
            <GroupActionsButton
              group={group}
              index={index}
              total={total}
              onRename={openRename}
              onDelete={openRemove}
            />
          </div>
        ) : (
          label
        )}
      </GroupContextMenu>

      <RenameGroupDialog group={group} open={renaming} onOpenChange={setRenaming} />
      <DeleteGroupDialog group={group} open={removing} onOpenChange={setRemoving} />
    </li>
  );
}
