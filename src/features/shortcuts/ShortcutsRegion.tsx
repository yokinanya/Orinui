import { useState } from 'react';

import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { DeleteFolderDialog } from '@/features/folders/DeleteFolderDialog';
import { RenameFolderDialog } from '@/features/folders/FolderDialogs';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';
import { HomeGrid } from '@/features/layout/HomeGrid';

/**
 * 快捷方式区域：主页网格（文件夹 + 网站），并承载主页的编辑模式。
 *
 * 点开文件夹格子进入该文件夹的弹层；编辑模式允许拖动排序。新增网站与小组件由右下角入口触发。
 * 文件夹的重命名与删除只在管理弹层里触发，主页网格本身不叠加更多按钮。
 */
interface ShortcutsRegionProps {
  readonly editing: boolean;
  readonly alignment?: 'center' | 'start';
  readonly onOpenFolder: (folderId: string) => void;
  readonly pendingHomeItem: string | null;
}

type FolderAction = { readonly kind: 'rename' | 'delete'; readonly folder: Folder } | null;

export function ShortcutsRegion({ editing, alignment = 'center', onOpenFolder, pendingHomeItem }: ShortcutsRegionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<Shortcut | null>(null);
  const [action, setAction] = useState<FolderAction>(null);

  const openCreate = () => {
    setTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (shortcut: Shortcut) => {
    setTarget(shortcut);
    setDialogOpen(true);
  };

  const closeAction = () => setAction(null);

  return (
    <section aria-label="快捷方式" data-layout-alignment={alignment} className="flex w-full min-w-0 flex-col gap-6">
      <HomeGrid editing={editing} onAdd={openCreate} onEdit={openEdit} onOpenFolder={onOpenFolder}
        pendingHomeItem={pendingHomeItem}
        onRenameFolder={(folder) => setAction({ kind: 'rename', folder })}
        onDeleteFolder={(folder) => setAction({ kind: 'delete', folder })} />
      <ShortcutFormDialog open={dialogOpen} onOpenChange={setDialogOpen} folderId={null} shortcut={target ?? undefined} />
      {action && action.kind === 'rename'
        && <RenameFolderDialog folder={action.folder} open onOpenChange={(next) => { if (!next) closeAction(); }} />}
      {action && action.kind === 'delete'
        && <DeleteFolderDialog folder={action.folder} open onOpenChange={(next) => { if (!next) closeAction(); }} />}
    </section>
  );
}
