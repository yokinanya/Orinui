import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

export function WebDavDisconnectDialog({ connection }: { readonly connection: ReturnType<typeof useWebDavConnection> }) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" disabled={connection.busy || connection.loading}
      onClick={() => setDisconnectOpen(true)}>断开同步</Button>
      <AlertDialog open={disconnectOpen} onOpenChange={(open) => { if (!connection.busy) setDisconnectOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>断开 WebDAV 同步？</AlertDialogTitle>
            <AlertDialogDescription>移除本机连接和密钥；本机与云端数据保留。</AlertDialogDescription>
          </AlertDialogHeader>
          {connection.error && <FieldError role="alert">{connection.error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={connection.busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={connection.busy} onClick={(event) => {
              event.preventDefault();
              void connection.disconnect();
            }}>确认断开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  </>;
}
