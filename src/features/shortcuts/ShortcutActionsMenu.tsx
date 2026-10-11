import { ArrowDownIcon, ArrowUpIcon, FolderInputIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Group } from '@/domain/group';
import type { Shortcut } from '@/domain/shortcut';
import { notifyError, notifyRemoved } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface ShortcutMenuProps {
  shortcut: Shortcut;
  onEdit: (shortcut: Shortcut) => void;
}

/**
 * 网站操作项。
 *
 * Base UI 的右键菜单与下拉菜单共用同一套 parts（`Menu.Item` 等），因此内容只写一份：
 * 左键「⋯」按钮与右键调出的是同一个菜单，标签、禁用状态与行为不会各写一套而漂移。
 */
interface ShortcutPositionItemsProps {
  readonly index: number;
  readonly total: number;
  readonly onMove: (direction: 'up' | 'down') => void;
}

function ShortcutPositionItems({ index, total, onMove }: ShortcutPositionItemsProps) {
  return (
    <>
      <ContextMenuItem disabled={index <= 0} onClick={() => onMove('up')}>
        <ArrowUpIcon />
        上移
      </ContextMenuItem>
      <ContextMenuItem disabled={index < 0 || index >= total - 1} onClick={() => onMove('down')}>
        <ArrowDownIcon />
        下移
      </ContextMenuItem>
    </>
  );
}

interface MoveToGroupItemsProps {
  readonly groups: readonly Group[];
  readonly onMove: (groupId: string) => void;
}

function MoveToGroupItems({ groups, onMove }: MoveToGroupItemsProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInputIcon />
        移动到分组
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {groups.length === 0 ? <ContextMenuItem disabled>没有其他分组</ContextMenuItem> : groups.map((group) => (
          <ContextMenuItem key={group.id} onClick={() => onMove(group.id)}>{group.name}</ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function ShortcutMenuItems({ shortcut, onEdit }: ShortcutMenuProps) {
  const { groups, shortcuts, moveShortcut, moveShortcutToGroup, deleteShortcut, restoreShortcut } = useData();
  const index = shortcuts.findIndex((item) => item.id === shortcut.id);
  const otherGroups = groups.filter((group) => group.id !== shortcut.groupId);
  const remove = () => {
    void (async () => {
      try {
        const removed = await deleteShortcut(shortcut.id);
        notifyRemoved(removed.title, () => void restoreShortcut(removed).catch(notifyError));
      } catch (error) { notifyError(error); }
    })();
  };
  const move = (direction: 'up' | 'down') => void moveShortcut(shortcut.id, direction).catch(notifyError);
  const moveToGroup = (groupId: string) => void moveShortcutToGroup(shortcut.id, groupId).catch(notifyError);

  return (
    <>
      <ContextMenuItem onClick={() => onEdit(shortcut)}>
        <PencilIcon />
        编辑
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ShortcutPositionItems index={index} total={shortcuts.length} onMove={move} />
      <MoveToGroupItems groups={otherGroups} onMove={moveToGroup} />
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={remove}>
        <Trash2Icon />
        删除
      </ContextMenuItem>
    </>
  );
}

interface ShortcutContextMenuProps extends ShortcutMenuProps {
  children: ReactNode;
}

/** 右键（或长按）网站时弹出的操作菜单。 */
export function ShortcutContextMenu({ shortcut, onEdit, children }: ShortcutContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ShortcutMenuItems shortcut={shortcut} onEdit={onEdit} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ShortcutActionsButtonProps extends ShortcutMenuProps {
  className?: string;
}

/** 编辑模式下暴露的键盘入口：不需要右键即可打开同一份操作菜单。 */
export function ShortcutActionsButton({ shortcut, onEdit, className }: ShortcutActionsButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(className, 'home-readable-control home-readable-focus')}
            aria-label={`${shortcut.title} 的操作`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <ShortcutMenuItems shortcut={shortcut} onEdit={onEdit} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
