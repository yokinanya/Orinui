import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';
import { WebDavDisconnectDialog } from '@/features/settings/WebDavDisconnectDialog';
import { WebDavDeleteDialog } from '@/features/settings/WebDavDeleteDialog';
import { SyncSizePreviewPanel } from '@/features/settings/SyncSizePreviewPanel';
import type { SyncSizePreview } from '@/sync/ports';

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

function WebDavStatus({ status, connectionError }: {
  readonly status: NonNullable<Connection['status']>; readonly connectionError: string | null;
}) {
  const error = status.error ?? connectionError;
  const description = error || `最近成功同步：${formatSyncTime(status.lastSuccessfulSyncAt)}`;
  return <Alert variant={status.state === 'error' ? 'destructive' : 'default'}>
    <AlertTitle>{statusLabel(status.state)}</AlertTitle><AlertDescription>{description}</AlertDescription>
  </Alert>;
}

export function WebDavConnectedPanel({ connection }: WebDavConnectedPanelProps) {
  const [sizePreview, setSizePreview] = useState<SyncSizePreview | null>(null);
  const status = connection.status;
  if (!status) return null;

  return (
    <section aria-labelledby="webdav-connected-title" className="flex flex-col gap-4">
      <div>
        <h3 id="webdav-connected-title" className="text-base font-medium">WebDAV 同步</h3>
        <p className="mt-1 break-all text-sm text-muted-foreground">{status.url}</p>
        <p className="break-all text-sm text-muted-foreground">账号：{status.username}</p>
      </div>
      <WebDavStatus status={status} connectionError={connection.error} />
      {connection.error && connection.error !== status.error && <FieldError role="alert">{connection.error}</FieldError>}
      {/* 与 S3 面板一致：主操作在最前，与断开一起归入操作组，破坏性删除单独靠右。 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={connection.busy || connection.loading} onClick={() => void connection.syncNow()}>
          {connection.busy ? '处理中…' : '立即同步'}
        </Button>
        <WebDavDisconnectDialog connection={connection} />
        <Button type="button" variant="outline" disabled={connection.busy || connection.loading}
          onClick={() => void connection.previewSizes().then(setSizePreview)}>
          {connection.busy ? '处理中…' : '预览同步大小'}
        </Button>
        <span className="flex-1" />
        <WebDavDeleteDialog connection={connection} />
      </div>
      {sizePreview && <SyncSizePreviewPanel preview={sizePreview} />}
    </section>
  );
}
