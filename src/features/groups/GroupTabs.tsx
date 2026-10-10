import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CheckIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateGroupDialog } from '@/features/groups/GroupDialogs';
import { SortableGroupTab } from '@/features/groups/SortableGroupTab';
import { notifyError } from '@/lib/notify';

/** 分组标签只在水平方向移动：纵向位移会让标签离开所在行。 */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface GroupTabsProps {
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

/**
 * 分组导航与编辑模式开关。
 *
 * 标签行本身负责切换分组；右键标签可改名、左右移动或删除。
 * 行末的「编辑」按钮切换编辑模式，进入后标签可拖动排序，并出现新建分组入口。
 * 列表用 w-max + mx-auto：标签少时居中，标签多时正常横向滚动而不会裁掉开头。
 */
export function GroupTabs({ editing, onEditingChange }: GroupTabsProps) {
  const { groups, activeGroupId, setActiveGroupId, reorderGroup } = useData();
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // 只用空格拿起／放下：Enter 留给标签自身的「切换分组」，避免编辑模式下无法用键盘换组
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const index = groups.findIndex((group) => group.id === String(over.id));
    if (index < 0) return;

    void reorderGroup(String(active.id), index).catch(notifyError);
  };

  const editButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={editing ? '完成编辑' : '编辑分组与网站'}
      aria-pressed={editing}
      onClick={() => onEditingChange(!editing)}
      className="rounded-full"
    >
      {editing ? <CheckIcon /> : <PencilIcon />}
    </Button>
  );

  return (
    <nav aria-label="分组" className="flex w-full items-center justify-center gap-2">
      <DndContext
        sensors={sensors}
        // 一维横向列表用 closestCorners：只要被拖动标签与相邻标签的矩形相交就切换目标，
        // closestCenter 在两者中心接近时需要拖过中点才切换，边界手感不稳定。
        collisionDetection={closestCorners}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={groups.map((group) => group.id)} strategy={horizontalListSortingStrategy}>
          <div className="min-w-0 overflow-x-auto">
            <ul className="mx-auto flex w-max items-center gap-1 px-1 md:gap-2">
              {groups.map((group, index) => (
                <SortableGroupTab
                  key={group.id}
                  group={group}
                  index={index}
                  total={groups.length}
                  active={group.id === activeGroupId}
                  editing={editing}
                  onSelect={setActiveGroupId}
                />
              ))}
            </ul>
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex shrink-0 items-center gap-1">
        {editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="新建分组"
            onClick={() => setCreating(true)}
            className="rounded-full"
          >
            <PlusIcon />
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger render={editButton} />
          <TooltipContent>{editing ? '完成编辑' : '编辑分组与网站'}</TooltipContent>
        </Tooltip>
      </div>

      <CreateGroupDialog open={creating} onOpenChange={setCreating} />
    </nav>
  );
}
