import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';
import { WebDavTemplateSelector } from '@/features/settings/WebDavTemplateSelector';
import { WebDavDeleteDialog } from '@/features/settings/WebDavDeleteDialog';

type Connection = ReturnType<typeof useWebDavConnection>;

interface WebDavCredentialsFormProps {
  readonly connection: Connection;
}

function ConnectionFeedback({ connection }: WebDavCredentialsFormProps) {
  if (connection.plan || (!connection.error && !connection.recoveryRequired)) return null;
  return <div className="flex flex-wrap items-center gap-1">
    {connection.error && <FieldError role="alert">{connection.error}</FieldError>}
    {connection.recoveryRequired && <WebDavDeleteDialog connection={connection} forgotten />}
  </div>;
}

export function WebDavCredentialsForm({ connection }: WebDavCredentialsFormProps) {
  const { busy, loading } = connection;
  const disabled = busy || loading || connection.plan !== null;

  return (
    <FieldGroup className="gap-4">
      <WebDavTemplateSelector template={connection.template} disabled={disabled} onSelect={connection.selectTemplate} />
      <Field>
        <FieldLabel htmlFor="webdav-url">WebDAV 地址</FieldLabel>
        <Input id="webdav-url" type="url" inputMode="url" autoComplete="url" placeholder={connection.template.urlPlaceholder} value={connection.url}
          disabled={disabled}
          onChange={(event) => connection.setUrl(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-username">账号</FieldLabel>
        <Input id="webdav-username" autoComplete="username" placeholder={connection.template.usernamePlaceholder} value={connection.username} disabled={disabled}
          onChange={(event) => connection.setUsername(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-password">{connection.template.passwordLabel}</FieldLabel>
        <Input id="webdav-password" type="password" autoComplete="current-password" value={connection.password} disabled={disabled}
          onChange={(event) => connection.setPassword(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-recovery-key">恢复密钥（可选）</FieldLabel>
        <Input id="webdav-recovery-key" autoComplete="off" spellCheck={false} value={connection.recoveryKey} disabled={disabled}
          onChange={(event) => connection.setRecoveryKey(event.target.value)} />
        <FieldDescription>已有同步库才填写；新建时留空。</FieldDescription>
      </Field>
      <ConnectionFeedback connection={connection} />
      <Button type="button" variant="outline" disabled={disabled || !connection.url || !connection.username || !connection.password}
        onClick={() => void connection.prepare()}>
        {busy ? '正在检查…' : '检查连接'}
      </Button>
    </FieldGroup>
  );
}
