import { openContextMenuFromKeyboard } from '@/features/folders/menu-keyboard';
import { ArrowDownIcon, ArrowUpIcon, FolderOpenIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { Folder } from '@/domain/folder';
import { useData } from '@/app/data-context';
import { notifyError } from '@/lib/notify';

export function FolderPositionItems({ folder }: { readonly folder: Folder }) {
  const { folders, moveFolder } = useData();
  const index = folders.findIndex((item) => item.id === folder.id);
  return <>
    <ContextMenuItem disabled={index <= 0} onClick={() => { void moveFolder(folder.id, 'up').catch(notifyError); }}>
      <ArrowUpIcon />上移
    </ContextMenuItem>
    <ContextMenuItem disabled={index < 0 || index === folders.length - 1} onClick={() => { void moveFolder(folder.id, 'down').catch(notifyError); }}>
      <ArrowDownIcon />下移
    </ContextMenuItem>
  </>;
}

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
        <FolderPositionItems folder={folder} />
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(folder)}><Trash2Icon />删除文件夹</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
