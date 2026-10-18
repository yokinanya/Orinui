import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

export function WebDavDeleteDialog({ connection, forgotten = false }: {
  readonly connection: ReturnType<typeof useWebDavConnection>; readonly forgotten?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const remove = async () => {
    const succeeded = await (forgotten ? connection.resetRemote() : connection.deleteRemote());
    if (succeeded) setOpen(false);
  };
  return <>
    <Button type="button" variant={forgotten ? 'link' : 'destructive'} disabled={connection.busy || connection.loading}
      onClick={() => setOpen(true)}>{forgotten ? '忘记恢复密钥？' : '删除远端同步库'}</Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!connection.busy) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除远端同步库？</AlertDialogTitle>
          <AlertDialogDescription>
            永久删除云端设置、所有设备快照和媒体，无法撤销；本机数据保留。请先停止其他设备同步，避免继续写入。
            {forgotten ? '删除后可重新检查连接，创建新库和恢复密钥。' : '删除成功后断开同步。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-all text-sm text-muted-foreground">{connection.status?.url ?? connection.url}</p>
        {connection.error && <FieldError role="alert">{connection.error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={connection.busy}>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={connection.busy} onClick={(event) => {
            event.preventDefault(); void remove();
          }}>{connection.busy ? '正在删除…' : '确认删除'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
