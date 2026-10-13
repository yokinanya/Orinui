import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

type Connection = ReturnType<typeof useWebDavConnection>;

interface WebDavPlanReviewProps {
  readonly connection: Connection;
}

function PlanCounts({ title, values }: { readonly title: string; readonly values: { groups: number; shortcuts: number; assets: number } }) {
  return <p className="text-sm text-muted-foreground">{title}：{values.groups} 个分组、{values.shortcuts} 个网站、{values.assets} 个图片资源</p>;
}

function RecoveryKeyPanel({ connection, recoveryKey }: { readonly connection: Connection; readonly recoveryKey: string }) {
  return (
    <Alert>
      <AlertTitle>先保存恢复密钥</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>密钥只显示一次。请妥善保存；丢失后无法读取云端数据。</p>
        <Field>
          <FieldLabel htmlFor="webdav-new-recovery-key">恢复密钥</FieldLabel>
          <Input id="webdav-new-recovery-key" readOnly value={recoveryKey} onFocus={(event) => event.currentTarget.select()} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-primary" checked={connection.keyAcknowledged} onChange={(event) => connection.setKeyAcknowledged(event.target.checked)} />
          <span>我已保存恢复密钥</span>
        </label>
      </AlertDescription>
    </Alert>
  );
}

function canConnect(connection: Connection, mode: 'create' | 'join', recoveryKey: string | undefined) {
  if (connection.busy || connection.loading) return false;
  if (mode === 'create' && !recoveryKey) return false;
  return !recoveryKey || connection.keyAcknowledged;
}

function PlanActions({ connection, mode, recoveryKey }: { readonly connection: Connection; readonly mode: 'create' | 'join'; readonly recoveryKey: string | undefined }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!canConnect(connection, mode, recoveryKey)} onClick={() => void connection.connect()}>
        {connection.busy ? '正在连接…' : '确认并启用'}
      </Button>
      <Button type="button" variant="outline" disabled={connection.busy || connection.loading} onClick={connection.cancel}>取消</Button>
    </div>
  );
}

export function WebDavPlanReview({ connection }: WebDavPlanReviewProps) {
  const { plan } = connection;
  if (!plan) return null;

  const newRecoveryKey = plan.mode === 'create' ? plan.recoveryKey : undefined;
  return (
    <section aria-labelledby="webdav-plan-title" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h3 id="webdav-plan-title" className="text-sm font-medium">首次合并预览</h3>
      <PlanCounts title="本机数据" values={plan.local} />
      <PlanCounts title="远端数据" values={plan.remote} />
      <p className="text-sm text-muted-foreground">两边的网站和分组都会保留；相同项会合并，已删除的项不会恢复。</p>
      {newRecoveryKey && <RecoveryKeyPanel connection={connection} recoveryKey={newRecoveryKey} />}
      {connection.error && <p role="alert" className="text-sm text-destructive">{connection.error}</p>}
      <PlanActions connection={connection} mode={plan.mode} recoveryKey={newRecoveryKey} />
    </section>
  );
}
