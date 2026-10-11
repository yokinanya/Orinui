import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { ReactNode } from 'react';

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

const AUTO_GROUP_ROLES = ['primary', 'secondary', 'tertiary'] as const;
type GroupRole = (typeof AUTO_GROUP_ROLES)[number];

function resolveGroupRole(role: Group['colorRole'], index: number): GroupRole {
  return role ?? AUTO_GROUP_ROLES[index % AUTO_GROUP_ROLES.length] ?? 'primary';
}

function roleClass(role: GroupRole, active: boolean): string {
  if (role === 'primary') return active ? 'bg-primary/15 text-primary' : 'hover:bg-primary/10 hover:text-primary';
  if (role === 'secondary') return active ? 'bg-secondary text-secondary-foreground' : 'hover:bg-secondary/70';
  return active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70';
}

interface GroupTabButtonProps {
  readonly group: Group;
  readonly active: boolean;
  readonly editing: boolean;
  readonly color: GroupRole;
  readonly onSelect: (id: string) => void;
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function GroupTabButton(props: GroupTabButtonProps) {
  const { group, active, editing, color, onSelect, attributes, listeners } = props;
  return (
    <button type="button" {...(editing ? { ...attributes, ...listeners } : {})}
      onClick={() => onSelect(group.id)} aria-current={active ? 'true' : undefined}
      data-color-role={color}
      className={cn('home-readable-group home-readable-focus rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50', !active && 'text-glass-foreground-muted',
        active && roleClass(color, true), !active && roleClass(color, false))}>
      {group.name}
    </button>
  );
}

interface EditableGroupTabProps {
  readonly group: Group;
  readonly index: number;
  readonly total: number;
  readonly active: boolean;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly children: ReactNode;
}

function EditableGroupTab({ group, index, total, active, onRename, onDelete, children }: EditableGroupTabProps) {
  return (
    <div className={cn('home-readable-group-shell flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-1 ring-1 ring-glass-border', active ? 'bg-glass' : 'bg-glass/30')}>
      {children}
      <GroupActionsButton group={group} index={index} total={total} onRename={onRename} onDelete={onDelete} />
    </div>
  );
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
  const color = resolveGroupRole(group.colorRole, index);

  const onRename = () => setRenaming(true);
  const onDelete = () => setRemoving(true);
  const label = <GroupTabButton group={group} active={active} editing={editing} color={color}
    onSelect={onSelect} attributes={attributes} listeners={listeners} />;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center', isDragging && 'z-10 opacity-90')}
    >
      <GroupContextMenu group={group} index={index} total={total} onRename={onRename} onDelete={onDelete}>
        {editing ? <EditableGroupTab group={group} index={index} total={total} active={active} onRename={onRename} onDelete={onDelete}>{label}</EditableGroupTab> : label}
      </GroupContextMenu>

      <RenameGroupDialog group={group} open={renaming} onOpenChange={setRenaming} />
      <DeleteGroupDialog group={group} open={removing} onOpenChange={setRemoving} />
    </li>
  );
}
