import { FieldDescription } from '@/components/ui/field';
import type { WebDavCounts } from '@/sync/webdav-types';

const COUNT_FIELDS = [
  { key: 'groups', label: '分组' },
  { key: 'shortcuts', label: '网站' },
  { key: 'assets', label: '图片' },
] as const;

interface WebDavMergeSummaryProps {
  readonly local: WebDavCounts;
  readonly remote: WebDavCounts;
}

export function WebDavMergeSummary({ local, remote }: WebDavMergeSummaryProps) {
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
      <FieldDescription>本机和云端的分组、网站与图片会合并；已删除的项目不会恢复。</FieldDescription>
    </div>
  );
}
