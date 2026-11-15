import { useEffect, useState } from 'react';

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
import { Button } from '@/components/ui/button';
import type { Folder } from '@/domain/folder';
import { canConfirmDelete, deleteFolderDescription, summarizeDelete, type DeleteSummary } from '@/features/folders/folder-delete';

interface DeleteFolderDialogProps {
  readonly folder: Folder;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 删除成功后通知调用方：当前层需要返回父层或刷新列表。 */
  readonly onDeleted?: (folder: Folder) => void;
}

/**
 * 删除文件夹前的二次确认。
 *
 * 删除只移除这一条记录：直接子文件夹与网站按原顺序提升到它的父层（顶层则回到主页），
 * 深层子树连同标识原样保留；网站本身不会被删除。确认文案同时给出数量与范围。
 * 统计失败时如实显示失败并提供重试，不显示假进度，也不用旧计数启用删除。
 */
export function DeleteFolderDialog({ folder, open, onOpenChange, onDeleted }: DeleteFolderDialogProps) {
  const { deleteFolder, folders, listAllShortcuts } = useData();
  const [summary, setSummary] = useState<DeleteSummary | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // 每次打开或重试都从干净状态开始：不沿用上一次（或上一次失败前）的计数。
    setSummary(null);
    setStatsError(null);
    setError(null);
    void (async () => {
      try {
        const allShortcuts = await listAllShortcuts();
        if (cancelled) return;
        setSummary(summarizeDelete(folders, allShortcuts, folder.id));
      } catch (cause) {
        if (!cancelled) setStatsError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [folder.id, folders, listAllShortcuts, open, version]);

  const retry = () => setVersion((value) => value + 1);

  const confirm = async () => {
    if (busy || summary === null) return;
    setError(null);
    setBusy(true);
    try {
      await deleteFolder(folder.id);
      onOpenChange(false);
      onDeleted?.(folder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const target = folder.parentId === null ? '主页' : '上一级文件夹';
  const description = deleteFolderDescription({ name: folder.name, target, summary, statsError });

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除文件夹「{folder.name}」？</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {statsError !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <span role="alert">统计失败：{statsError}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>重试统计</Button>
          </div>
        )}
        {error !== null && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirmDelete({ summary, busy, statsError })}
            onClick={(event) => { event.preventDefault(); void confirm(); }}>
            {busy ? '正在删除…' : '删除文件夹'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
