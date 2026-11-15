import { openContextMenuFromKeyboard } from '@/features/folders/menu-keyboard';
import { FolderOpenIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { Folder } from '@/domain/folder';

/**
 * 文件夹操作菜单。
 *
 * 自有文件夹可任意嵌套，但不可移动、不可改父、不可重排：这里只保留打开、重命名与删除。
 * 删除只提升直接子项，深层子树和网站标识都保留，由删除确认说明范围。
 */
export function FolderContextMenu({ folder, onOpen, onRename, onDelete, children }: {
  readonly folder: Folder;
  readonly onOpen: (folderId: string) => void;
  readonly onRename: (folder: Folder) => void;
  readonly onDelete: (folder: Folder) => void;
  readonly children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full" onKeyDown={openContextMenuFromKeyboard}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onOpen(folder.id)}><FolderOpenIcon />打开文件夹</ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(folder)}><PencilIcon />重命名</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(folder)}><Trash2Icon />删除文件夹</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
