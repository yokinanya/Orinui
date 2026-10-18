import type { SyncSizePreview } from '@/sync/ports';
import { FieldDescription } from '@/components/ui/field';
import { formatBytes } from '@/lib/format-bytes';

function displayBytes(value: number | null): string {
  return value === null ? '无法取得' : formatBytes(value);
}

export function SyncSizePreviewPanel({ preview }: { readonly preview: SyncSizePreview }) {
  const measuredAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(preview.measuredAt);
  return <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/15 p-3">
    <h4 className="text-sm font-medium">下次同步大小</h4>
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
      <dt>本机媒体原件</dt><dd className="text-right tabular-nums">{formatBytes(preview.localMediaBytes)}</dd>
      <dt>云端总占用</dt><dd className="text-right tabular-nums">{formatBytes(preview.remoteVaultBytes)}</dd>
      <dt>媒体预计下载（{preview.downloadMediaObjects} 项）</dt><dd className="text-right tabular-nums">{displayBytes(preview.downloadMediaBytes)}</dd>
      <dt>媒体预计上传（{preview.uploadMediaObjects} 项）</dt><dd className="text-right tabular-nums">{formatBytes(preview.uploadMediaBytes)}</dd>
      <dt>现有快照读取（{preview.downloadSnapshotObjects} 项）</dt><dd className="text-right tabular-nums">{displayBytes(preview.downloadSnapshotBytes)}</dd>
      <dt>本机快照发布</dt><dd className="text-right tabular-nums">{formatBytes(preview.uploadSnapshotBytes)}</dd>
    </dl>
    <FieldDescription>按加密后大小估算，不含请求开销；云端占用含未引用数据。更新于 {measuredAt}。</FieldDescription>
  </div>;
}
