import { ArrowLeftIcon, ArrowRightIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Group } from '@/domain/group';
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
 * 与网站菜单同构：右键菜单与编辑模式下的「⋯」按钮共用同一份内容。
 * 系统默认分组可改名与移动，但不可删除。
 */
function GroupMenuItems({ group, index, total, onRename, onDelete }: GroupMenuProps) {
  const { moveGroup } = useData();

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

interface GroupActionsButtonProps extends GroupMenuProps {
  className?: string;
}

/** 编辑模式下暴露的键盘入口：不需要右键即可打开同一份操作菜单。 */
export function GroupActionsButton({ group, className, ...menu }: GroupActionsButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={className}
            aria-label={`${group.name} 分组的操作`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <GroupMenuItems group={group} {...menu} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
