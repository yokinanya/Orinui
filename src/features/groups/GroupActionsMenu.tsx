import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { Group } from '@/domain/group';
import { GROUP_COLOR_ROLES } from '@/domain/group';
import { notifyError } from '@/lib/notify';

interface GroupMenuProps {
  group: Group;
  index: number;
  total: number;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * 分组操作项。
 *
 * 标签右键与菜单键共用同一份操作内容。
 * 系统默认分组可改名与移动，但不可删除。
 */
function GroupMenuItems({ group, index, total, onRename, onDelete }: GroupMenuProps) {
  const { moveGroup, updateGroupColor } = useData();

  const move = (direction: 'up' | 'down') => {
    void moveGroup(group.id, direction).catch(notifyError);
  };

  return (
    <>
      <ContextMenuItem onClick={onRename}>
        <PencilIcon />
        重命名
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={index <= 0} onClick={() => move('up')}>
        <ArrowLeftIcon />
        左移
      </ContextMenuItem>
      <ContextMenuItem disabled={index >= total - 1} onClick={() => move('down')}>
        <ArrowRightIcon />
        右移
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>标签颜色</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={group.isDefault} onClick={() => void updateGroupColor(group.id, null).catch(notifyError)}>
            {group.colorRole === null && <CheckIcon />} 自动分配
          </ContextMenuItem>
          {GROUP_COLOR_ROLES.map((role) => <ContextMenuItem key={role}
            disabled={group.isDefault && role !== 'primary'}
            onClick={() => void updateGroupColor(group.id, role).catch(notifyError)}>
            {group.colorRole === role && <CheckIcon />}{role === 'primary' ? '主色' : role === 'secondary' ? '次色' : '第三色'}
          </ContextMenuItem>)}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={group.isDefault} onClick={onDelete}>
        <Trash2Icon />
        {group.isDefault ? '默认分组不可删除' : '删除分组'}
      </ContextMenuItem>
    </>
  );
}

interface GroupContextMenuProps extends GroupMenuProps {
  children: ReactNode;
}

/** 右键（或长按）分组标签时弹出的操作菜单。 */
export function GroupContextMenu({ children, ...menu }: GroupContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="rounded-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <GroupMenuItems {...menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
