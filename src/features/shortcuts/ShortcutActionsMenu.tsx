import { openContextMenuFromKeyboard } from '@/features/folders/menu-keyboard';
import { ArrowDownIcon, ArrowUpIcon, FolderInputIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { useOperations } from '@/app/operations';
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
import type { Folder } from '@/domain/folder';
import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';
import { notifyError, notifyRemoved } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface ShortcutMenuProps {
  readonly shortcut: Shortcut;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly containerShortcuts: readonly Shortcut[];
  readonly onChanged: () => void;
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

interface MoveToFolderItemsProps {
  readonly folders: readonly Folder[];
  readonly includeHome: boolean;
  readonly onMove: (folderId: string | null) => void;
}

function MoveToFolderItems({ folders, includeHome, onMove }: MoveToFolderItemsProps) {
  const empty = folders.length === 0 && !includeHome;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInputIcon />
        移动到文件夹
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {empty ? <ContextMenuItem disabled>没有其他文件夹</ContextMenuItem> : <>
          {includeHome && <ContextMenuItem onClick={() => onMove(null)}>主页</ContextMenuItem>}
          {folders.map((folder) => (
            <ContextMenuItem key={folder.id} onClick={() => onMove(folder.id)}>{folder.name}</ContextMenuItem>
          ))}
        </>}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function ShortcutMenuItems({ shortcut, onEdit, containerShortcuts, onChanged }: ShortcutMenuProps) {
  const { folders, moveShortcut, moveShortcutToFolder, deleteShortcut, restoreShortcut } = useData();
  const operations = useOperations();
  const index = containerShortcuts.findIndex((item) => item.id === shortcut.id);
  // 主页网格上的网站可以移进任意文件夹；文件夹里的网站还能移回主页。
  const candidates = shortcut.folderId === null ? folders : folders.filter((folder) => folder.id !== shortcut.folderId);
  const remove = () => {
    void (async () => {
      try {
        const removed = await deleteShortcut(shortcut.id);
        onChanged();
        notifyRemoved(operations, shortcutDisplayName(removed), () => {
          restoreShortcut(removed).then(onChanged).catch((error: unknown) => { notifyError(error); });
        });
      } catch (error) { notifyError(error); }
    })();
  };
  const move = async (direction: 'up' | 'down') => {
    await moveShortcut(shortcut.id, direction);
    onChanged();
  };
  const moveToFolder = async (folderId: string | null) => {
    await moveShortcutToFolder(shortcut.id, folderId);
    onChanged();
  };

  return (
    <>
      <ContextMenuItem onClick={() => onEdit(shortcut)}>
        <PencilIcon />
        编辑
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ShortcutPositionItems index={index} total={containerShortcuts.length} onMove={(direction) => { void move(direction).catch(notifyError); }} />
      <MoveToFolderItems folders={candidates} includeHome={shortcut.folderId !== null}
        onMove={(folderId) => { void moveToFolder(folderId).catch(notifyError); }} />
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
export function ShortcutContextMenu({ shortcut, onEdit, containerShortcuts, onChanged, children }: ShortcutContextMenuProps) {
  const container = useRef<HTMLElement | null>(null);
  const restoreFocus = () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog && dialog !== container.current) return false;
    return container.current ?? true;
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full" onKeyDown={openContextMenuFromKeyboard}
        ref={(element) => {
          if (element) container.current = element.closest<HTMLElement>('[role="dialog"]');
        }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" finalFocus={restoreFocus}>
        <ShortcutMenuItems shortcut={shortcut} onEdit={onEdit} containerShortcuts={containerShortcuts} onChanged={onChanged} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ShortcutActionsButtonProps extends ShortcutMenuProps {
  readonly className?: string;
}

/** 编辑模式下暴露的键盘入口：不需要右键即可打开同一份操作菜单。 */
export function ShortcutActionsButton({ shortcut, onEdit, containerShortcuts, onChanged, className }: ShortcutActionsButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(className, 'home-readable-control home-readable-focus')}
            aria-label={`${shortcutDisplayName(shortcut)} 的操作`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <ShortcutMenuItems shortcut={shortcut} onEdit={onEdit} containerShortcuts={containerShortcuts} onChanged={onChanged} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
