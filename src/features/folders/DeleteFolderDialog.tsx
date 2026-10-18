import { useState } from 'react';

import { useData } from '@/app/data-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Folder } from '@/domain/folder';

interface DeleteFolderDialogProps {
  readonly folder: Folder;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * 删除文件夹前的二次确认。
 *
 * 文件夹只是容器：其中的网站会回到主页网格，不会一并删除。
 */
export function DeleteFolderDialog({ folder, open, onOpenChange }: DeleteFolderDialogProps) {
  const { deleteFolder } = useData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await deleteFolder(folder.id);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除文件夹「{folder.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            文件夹里的网站会回到主页网格，不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>
            {busy ? '正在删除…' : '删除文件夹'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
