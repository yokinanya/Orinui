import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

type Connection = ReturnType<typeof useWebDavConnection>;

interface WebDavConnectedPanelProps {
  readonly connection: Connection;
}

function formatSyncTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return '尚未成功同步';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function statusLabel(state: NonNullable<Connection['status']>['state']): string {
  const labels = { pending: '等待同步', syncing: '正在同步', synced: '已同步', error: '同步出错' };
  return labels[state];
}

export function WebDavConnectedPanel({ connection }: WebDavConnectedPanelProps) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const status = connection.status;
  if (!status) return null;

  return (
    <section aria-labelledby="webdav-connected-title" className="flex flex-col gap-4">
      <div>
        <h3 id="webdav-connected-title" className="text-sm font-medium">WebDAV 同步</h3>
        <p className="mt-1 break-all text-sm text-muted-foreground">{status.url}</p>
        <p className="break-all text-sm text-muted-foreground">账号：{status.username}</p>
      </div>
      <Alert variant={status.state === 'error' ? 'destructive' : 'default'}>
        <AlertTitle>{statusLabel(status.state)}</AlertTitle>
        <AlertDescription>
          {status.error || `最近成功同步：${formatSyncTime(status.lastSuccessfulSyncAt)}`}
        </AlertDescription>
      </Alert>
      {connection.error && connection.error !== status.error && <FieldError role="alert">{connection.error}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={connection.busy || connection.loading} onClick={() => void connection.syncNow()}>
          {connection.busy ? '正在同步…' : '立即同步'}
        </Button>
        <Button type="button" variant="outline" disabled={connection.busy || connection.loading} onClick={() => setDisconnectOpen(true)}>断开同步</Button>
      </div>
      <AlertDialog open={disconnectOpen} onOpenChange={(open) => { if (!connection.busy) setDisconnectOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>断开 WebDAV 同步？</AlertDialogTitle>
            <AlertDialogDescription>只移除本机连接和密钥，本机与云端数据都会保留。</AlertDialogDescription>
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
    </section>
  );
}
