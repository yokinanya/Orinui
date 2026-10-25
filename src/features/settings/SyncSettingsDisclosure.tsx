import type { ReactNode } from 'react';

interface SyncConnectionSummary {
  readonly status: { readonly state: 'pending' | 'syncing' | 'synced' | 'error'; readonly error?: string } | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
}

const STATE_LABELS = { pending: '等待同步', syncing: '正在同步', synced: '已同步', error: '同步出错' };

function connectionLabel(connection: SyncConnectionSummary): string {
  const error = connection.error ?? connection.status?.error;
  if (error) return `同步出错：${error}`;
  if (connection.loading) return '正在读取同步状态…';
  if (connection.busy) return '处理中…';
  if (connection.status) return STATE_LABELS[connection.status.state];
  return '未连接';
}

export function SyncSettingsDisclosure({ connection, children }: {
  readonly connection: SyncConnectionSummary;
  readonly children: ReactNode;
}) {
  return <details className="min-w-0">
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring">
      配置与连接 · {connectionLabel(connection)}
    </summary>
    <div className="mt-4 flex min-w-0 flex-col gap-4">{children}</div>
  </details>;
}
