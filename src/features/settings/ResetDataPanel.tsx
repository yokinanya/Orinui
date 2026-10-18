import { useState } from 'react';
import { useData } from '@/app/data-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldGroup } from '@/components/ui/field';
import { useOperations } from '@/app/operations';

export function ResetDataPanel() {
  const { resetLocalData } = useData();
  const operations = useOperations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    setError(null);
    const task = operations.begin('重置本地数据', '清除本地数据');
    try { await resetLocalData(); setOpen(false); task.succeed('本地数据已重置'); }
    catch (cause) { task.fail(cause); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <FieldGroup>
      <FieldDescription>清除所有本地数据，Chrome 扩展会保留。</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>重置本地数据</Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除本地数据？</AlertDialogTitle>
            <AlertDialogDescription>本机网站、文件夹、背景和设置都会删除，并恢复为空白主页。</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <FieldError role="alert">{error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void reset(); }}>
              {busy ? '正在重置…' : '永久重置'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldGroup>
  );
}
