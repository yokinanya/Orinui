import { useState } from 'react';
import { useS3Sync } from '@/app/s3-sync-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { WebDavMergeSummary } from '@/features/settings/WebDavMergeSummary';
import { WebDavRecoveryKeyPanel } from '@/features/settings/WebDavRecoveryKeyPanel';
import { formatBytes } from '@/lib/format-bytes';
import { SyncSizePreviewPanel } from '@/features/settings/SyncSizePreviewPanel';
import type { S3Credentials } from '@/domain/s3-configuration';

function R2Defaults({ onApply }: { readonly onApply: () => void }) {
  return <Button type="button" size="sm" variant="outline" onClick={onApply}>使用 Cloudflare R2 配置</Button>;
}

type CredentialField = keyof S3Credentials;
interface S3FormFieldsProps { readonly credentials: S3Credentials; readonly update: (field: CredentialField, value: string) => void }

function S3FormFields({ credentials, update }: S3FormFieldsProps) {
  return <>
    <Field><FieldLabel htmlFor="s3-endpoint">HTTPS endpoint</FieldLabel>
      <Input id="s3-endpoint" type="url" autoComplete="url" value={credentials.endpoint} onChange={(event) => update('endpoint', event.target.value)} />
    </Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="s3-bucket">Bucket</FieldLabel>
        <Input id="s3-bucket" autoComplete="off" value={credentials.bucket} onChange={(event) => update('bucket', event.target.value)} />
      </Field>
      <Field><FieldLabel htmlFor="s3-prefix">专用 Prefix</FieldLabel>
        <Input id="s3-prefix" autoComplete="off" value={credentials.prefix} onChange={(event) => update('prefix', event.target.value)} />
      </Field>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="s3-region">Region</FieldLabel>
        <Input id="s3-region" autoComplete="off" value={credentials.region} onChange={(event) => update('region', event.target.value)} />
      </Field>
      <Field><FieldLabel htmlFor="s3-access-key">Access Key ID</FieldLabel>
        <Input id="s3-access-key" autoComplete="off" value={credentials.accessKeyId}
          onChange={(event) => update('accessKeyId', event.target.value)} />
      </Field>
    </div>
    <Field><FieldLabel htmlFor="s3-secret-key">Secret Access Key</FieldLabel>
      <Input id="s3-secret-key" type="password" autoComplete="new-password" value={credentials.secretAccessKey}
        onChange={(event) => update('secretAccessKey', event.target.value)} />
    </Field>
  </>;
}

function S3PlanReview({ connection, acknowledged, onAcknowledged }: {
  readonly connection: ReturnType<typeof useS3Sync>; readonly acknowledged: boolean;
  readonly onAcknowledged: (value: boolean) => void;
}) {
  const plan = connection.plan;
  if (!plan) return null;
  return <section aria-labelledby="s3-plan-title" className="flex flex-col gap-3 border-t pt-4">
    <h4 id="s3-plan-title" className="text-sm font-medium">首次合并与容量预览</h4>
    <WebDavMergeSummary local={plan.local} remote={plan.remote} remoteObjectBytes={plan.remoteObjectBytes} />
    <FieldDescription>仅统计当前同步库，不含其他目录；不代表费用。</FieldDescription>
    {plan.recoveryKey && <WebDavRecoveryKeyPanel value={plan.recoveryKey} acknowledged={acknowledged}
      disabled={connection.busy || connection.loading} onAcknowledgedChange={onAcknowledged} />}
    <FieldDescription>请先创建 Bucket，授权访问 endpoint，并在 Bucket CORS 中允许扩展来源、暴露 ETag。</FieldDescription>
  </section>;
}

function S3SettingsForm({ connection }: { readonly connection: ReturnType<typeof useS3Sync> }) {
  const [credentials, setCredentials] = useState<S3Credentials>({ endpoint: '', bucket: '', prefix: 'orinui',
    region: '', accessKeyId: '', secretAccessKey: '' });
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);
  const discardPlan = () => { connection.cancelPlan(); setKeyAcknowledged(false); };
  const update = (field: CredentialField, value: string) => {
    discardPlan(); setCredentials((current) => ({ ...current, [field]: value }));
  };
  const canConnect = !connection.busy && Boolean(connection.plan)
    && (connection.plan?.mode === 'join' ? Boolean(recoveryKey) : Boolean(connection.plan?.recoveryKey && keyAcknowledged));
  const check = () => { setKeyAcknowledged(false); void connection.prepare(credentials, recoveryKey || undefined); };

  return <section aria-label="S3 连接配置" className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <R2Defaults onApply={() => { discardPlan(); setCredentials((current) => ({ ...current,
        endpoint: 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com', region: 'auto' })); }} />
    </div>
    <S3FormFields credentials={credentials} update={update} />
    <Field><FieldLabel htmlFor="s3-recovery-key">恢复密钥</FieldLabel>
      <Input id="s3-recovery-key" type="password" autoComplete="off" value={recoveryKey}
        onChange={(event) => { discardPlan(); setRecoveryKey(event.target.value); }} />
      <FieldDescription>新建时留空并保存新密钥；加入已有库时填写原密钥。</FieldDescription>
    </Field>
    {connection.error && <FieldError role="alert">{connection.error}</FieldError>}
    {connection.recoveryTarget && <S3ForgotKeyDialog connection={connection} />}
    <S3ConnectionActions connection={connection} canConnect={canConnect} check={check} />
    <S3PlanReview connection={connection} acknowledged={keyAcknowledged} onAcknowledged={setKeyAcknowledged} />
  </section>;
}

function S3ConnectionActions({ connection, canConnect, check }: {
  readonly connection: ReturnType<typeof useS3Sync>; readonly canConnect: boolean; readonly check: () => void;
}) {
  return <div className="flex flex-wrap justify-end gap-2">
    {connection.plan && <Button type="button" variant="ghost" disabled={connection.busy} onClick={connection.cancelPlan}>取消检查</Button>}
    <Button type="button" variant="outline" disabled={connection.busy || connection.loading}
      onClick={check}>{connection.busy ? '正在检查…' : '检查连接'}</Button>
    {connection.plan && <Button type="button" disabled={!canConnect} onClick={() => void connection.connect()}>
      {connection.busy ? '正在连接…' : '确认并启用'}</Button>}
  </div>;
}

function S3ForgotKeyDialog({ connection }: { readonly connection: ReturnType<typeof useS3Sync> }) {
  const target = connection.recoveryTarget;
  if (!target) return null;
  return <AlertDialog>
    <AlertDialogTrigger render={<Button type="button" variant="outline">忘记恢复密钥？</Button>} />
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>删除无法解锁的 S3 同步库？</AlertDialogTitle>
        <AlertDialogDescription>永久删除 Bucket「{target.configuration.credentials.bucket}」的目录「{target.configuration.credentials.prefix || '（根目录）'}」中的 Orinui 同步库，无法撤销。请先停止其他设备同步。Bucket 和目录外数据保留。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction onClick={(event) => { event.preventDefault(); void connection.resetRemote(); }}>删除远端库</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function S3ConnectedPanel({ connection }: { readonly connection: ReturnType<typeof useS3Sync> }) {
  const status = connection.status;
  if (!status) return null;
  return <section aria-label="S3 连接状态" className="flex flex-col gap-3">
    <p className="break-all text-sm text-muted-foreground">{status.bucket} / {status.prefix || '（根目录）'} · {status.endpoint}</p>
    <S3StatusAlert status={status} error={connection.error} />
    <S3ConnectedActions connection={connection} status={status} />
    {connection.sizePreview && <SyncSizePreviewPanel preview={connection.sizePreview} />}
  </section>;
}

function S3StatusAlert({ status, error }: { readonly status: NonNullable<ReturnType<typeof useS3Sync>['status']>;
  readonly error: string | null }) {
  const labels = { pending: '等待同步', syncing: '正在同步', synced: '已同步', error: '同步出错' };
  const description = error ?? status.error ?? `同步库：${status.vaultId}`;
  return <Alert variant={status.state === 'error' ? 'destructive' : 'default'}>
    <AlertTitle>{labels[status.state]}</AlertTitle><AlertDescription>{description}</AlertDescription>
  </Alert>;
}

function S3ConnectedActions({ connection, status }: { readonly connection: ReturnType<typeof useS3Sync>;
  readonly status: NonNullable<ReturnType<typeof useS3Sync>['status']> }) {
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" disabled={connection.busy || connection.loading} onClick={() => void connection.syncNow()}>
      {connection.busy ? '处理中…' : '立即同步'}
    </Button>
    <Button type="button" variant="outline" disabled={connection.busy} onClick={() => void connection.disconnect()}>断开同步</Button>
    <Button type="button" variant="outline" disabled={connection.busy || connection.loading}
      onClick={() => void connection.previewSizes()}>{connection.busy ? '处理中…' : '预览同步大小'}</Button>
    <span className="flex-1" />
    <S3DeleteDialog connection={connection} status={status} />
  </div>;
}

function S3DeleteDialog({ connection, status }: { readonly connection: ReturnType<typeof useS3Sync>;
  readonly status: NonNullable<ReturnType<typeof useS3Sync>['status']> }) {
  return <AlertDialog>
    <AlertDialogTrigger render={<Button type="button" variant="destructive" disabled={connection.busy}>删除远端同步库</Button>} />
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>永久删除 S3 远端同步库？</AlertDialogTitle>
        <AlertDialogDescription>永久删除当前目录中的同步库「{status.vaultId}」，无法撤销。Bucket 和其他目录不受影响。请先停止其他设备同步。本机数据保留，删除成功后断开；失败时保留连接，可重试。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction onClick={(event) => { event.preventDefault(); void connection.deleteRemote(); }}>永久删除同步库</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function S3SyncPanel() {
  const connection = useS3Sync();
  if (connection.loading && !connection.status) return <p role="status" className="text-sm text-muted-foreground">正在读取 S3 同步状态…</p>;
  return <div className="flex flex-col gap-4">
    {connection.status ? <S3ConnectedPanel connection={connection} /> : <S3SettingsForm connection={connection} />}
  </div>;
}
