import { FieldDescription } from '@/components/ui/field';
import type { WebDavCounts } from '@/sync/webdav-types';
import { formatBytes } from '@/lib/format-bytes';

const COUNT_FIELDS = [
  { key: 'folders', label: '文件夹' },
  { key: 'shortcuts', label: '网站' },
  { key: 'assets', label: '媒体' },
] as const;

interface WebDavMergeSummaryProps {
  readonly local: WebDavCounts;
  readonly remote: WebDavCounts;
  readonly remoteObjectBytes: number;
}

export function WebDavMergeSummary({ local, remote, remoteObjectBytes }: WebDavMergeSummaryProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl bg-muted/25 px-3 py-2.5">
        <table className="w-full table-fixed border-collapse text-sm" aria-label="本机和云端数据数量">
          <thead>
            <tr className="border-b border-border/40 text-xs text-muted-foreground">
              <th scope="col" className="w-1/4 pb-2 text-left font-normal">数据</th>
              {COUNT_FIELDS.map(({ key, label }) => (
                <th key={key} scope="col" className="pb-2 text-right font-normal">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:first-child>th]:pt-2">
            <tr>
              <th scope="row" className="text-left font-medium">本机</th>
              {COUNT_FIELDS.map(({ key }) => <td key={key} className="text-right tabular-nums">{local[key]}</td>)}
            </tr>
            <tr>
              <th scope="row" className="pt-1 text-left font-medium">云端</th>
              {COUNT_FIELDS.map(({ key }) => <td key={key} className="pt-1 text-right tabular-nums">{remote[key]}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">本机素材：{formatBytes(local.assetBytes)} · 云端已引用素材：{formatBytes(remote.assetBytes)}</p>
      <p className="text-xs text-muted-foreground">云端总占用：{formatBytes(remoteObjectBytes)}（连接检查时）</p>
      <FieldDescription>合并本机与云端数据；已删除项目不会恢复。</FieldDescription>
    </div>
  );
}
