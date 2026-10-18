import { PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';
import { ShortcutGrid } from '@/features/shortcuts/ShortcutGrid';

interface FolderDialogProps {
  readonly folder: Folder;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** 读取文件夹内容；每次打开都重新读取，避免撤销删除后显示旧列表。 */
function useFolderShortcuts(folderId: string, open: boolean) {
  const { loadFolderShortcuts, shortcuts: homepageShortcuts } = useData();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void loadFolderShortcuts(folderId)
      .then((items) => { if (!cancelled) setShortcuts(items); })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [folderId, open, version, homepageShortcuts, loadFolderShortcuts]);
  return { shortcuts, error, reload: () => setVersion((value) => value + 1) };
}

/**
 * 文件夹弹层。
 *
 * 主页网格里点开文件夹后显示其中的网站；新建网站默认放进这个文件夹。
 * 弹层内保持与主页相同的网格交互，编辑、排序与删除都走同一套菜单。
 */
export function FolderDialog({ folder, open, onOpenChange }: FolderDialogProps) {
  const { shortcuts, error, reload } = useFolderShortcuts(folder.id, open);
  const [formOpen, setFormOpen] = useState(false);
  const [target, setTarget] = useState<Shortcut | null>(null);

  const openCreate = () => { setTarget(null); setFormOpen(true); };
  const openEdit = (shortcut: Shortcut) => { setTarget(shortcut); setFormOpen(true); };
  const afterSave = () => { setFormOpen(false); reload(); };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{folder.name}</DialogTitle>
            <DialogDescription>{shortcuts.length} 个网站</DialogDescription>
          </DialogHeader>
          {error !== null && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="max-h-[60dvh] overflow-y-auto">
            <ShortcutGrid shortcuts={[...shortcuts]} folders={[]} onShortcutsChanged={reload} editing={false} showActions
              alignment="center" onEdit={openEdit} onAdd={openCreate}
              onOpenFolder={() => {}} onEditFolder={() => {}} onDeleteFolder={() => {}} />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={openCreate} className="home-readable-focus">
              <PlusIcon data-icon="inline-start" />
              添加网站
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {formOpen && <ShortcutFormDialog open={formOpen} onOpenChange={(next) => { if (!next) afterSave(); }}
        folderId={folder.id} shortcut={target ?? undefined} />}
    </>
  );
}
