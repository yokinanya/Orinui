import { useState } from 'react';
import { useData } from '@/app/data-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldGroup } from '@/components/ui/field';

export function ResetDataPanel() {
  const { resetLocalData } = useData();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    setError(null);
    try { await resetLocalData(); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <FieldGroup>
      <FieldDescription>清除网站、分组、背景图片和设置，并恢复空白默认分组。扩展本身不受影响。</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>重置本地数据</Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除本地数据？</AlertDialogTitle>
            <AlertDialogDescription>网站、分组、自定义背景和所有设置都会删除，并创建一个空的「常用」分组。</AlertDialogDescription>
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
