import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { WebDavMergeSummary } from '@/features/settings/WebDavMergeSummary';
import { WebDavRecoveryKeyPanel } from '@/features/settings/WebDavRecoveryKeyPanel';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

type Connection = ReturnType<typeof useWebDavConnection>;

interface WebDavPlanReviewProps {
  readonly connection: Connection;
}

function canConnect(connection: Connection, mode: 'create' | 'join', recoveryKey: string | undefined) {
  if (connection.busy || connection.loading) return false;
  if (mode === 'create' && !recoveryKey) return false;
  return !recoveryKey || connection.keyAcknowledged;
}

function PlanActions({ connection, mode, recoveryKey }: { readonly connection: Connection; readonly mode: 'create' | 'join'; readonly recoveryKey: string | undefined }) {
  return (
    <div className="flex flex-col gap-2 @sm/webdav-plan:flex-row @sm/webdav-plan:justify-end">
      <Button type="button" className="@sm/webdav-plan:order-last" disabled={!canConnect(connection, mode, recoveryKey)} onClick={() => void connection.connect()}>
        {connection.busy ? '正在连接…' : '确认并启用'}
      </Button>
      <Button type="button" variant="ghost" disabled={connection.busy || connection.loading} onClick={connection.cancel}>取消</Button>
    </div>
  );
}

export function WebDavPlanReview({ connection }: WebDavPlanReviewProps) {
  const { plan } = connection;
  if (!plan) return null;

  const newRecoveryKey = plan.mode === 'create' ? plan.recoveryKey : undefined;
  return (
    <section aria-labelledby="webdav-plan-title" className="@container/webdav-plan flex min-w-0 flex-col gap-4">
      <Separator />
      <h3 id="webdav-plan-title" className="text-base font-medium">首次合并预览</h3>
      <WebDavMergeSummary local={plan.local} remote={plan.remote} />
      {plan.consistencyMode === 'readback-only' ? <p role="note" className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        如复制了浏览器配置，请勿让多个副本同时同步同一个库，以免数据被覆盖。
      </p> : null}
      {newRecoveryKey ? <WebDavRecoveryKeyPanel value={newRecoveryKey} acknowledged={connection.keyAcknowledged}
        disabled={connection.busy || connection.loading} onAcknowledgedChange={connection.setKeyAcknowledged} /> : null}
      {plan.mode === 'create' && !newRecoveryKey ? <FieldError role="alert">创建同步库缺少恢复密钥，无法启用同步。</FieldError> : null}
      {connection.error ? <FieldError role="alert">{connection.error}</FieldError> : null}
      <PlanActions connection={connection} mode={plan.mode} recoveryKey={newRecoveryKey} />
    </section>
  );
}
