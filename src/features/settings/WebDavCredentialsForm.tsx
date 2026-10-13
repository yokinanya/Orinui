import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { useWebDavConnection } from '@/features/settings/use-webdav-connection';

type Connection = ReturnType<typeof useWebDavConnection>;

interface WebDavCredentialsFormProps {
  readonly connection: Connection;
}

export function WebDavCredentialsForm({ connection }: WebDavCredentialsFormProps) {
  const { busy, loading } = connection;
  const disabled = busy || loading || connection.plan !== null;

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="webdav-url">WebDAV 地址</FieldLabel>
        <Input id="webdav-url" type="url" inputMode="url" autoComplete="url" placeholder="https://dav.example.com/orinui" value={connection.url}
          disabled={disabled}
          onChange={(event) => connection.setUrl(event.target.value)} />
        <FieldDescription>使用 HTTPS，并为 Orinui 指定专用文件夹；其父目录需已存在。目录内容仅存加密同步数据。</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-username">账号</FieldLabel>
        <Input id="webdav-username" autoComplete="username" value={connection.username} disabled={disabled}
          onChange={(event) => connection.setUsername(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-password">应用密码</FieldLabel>
        <Input id="webdav-password" type="password" autoComplete="current-password" value={connection.password} disabled={disabled}
          onChange={(event) => connection.setPassword(event.target.value)} />
        <FieldDescription>仅保存在本机，用于访问此 WebDAV 地址。</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="webdav-recovery-key">恢复密钥（可选）</FieldLabel>
        <Input id="webdav-recovery-key" autoComplete="off" spellCheck={false} value={connection.recoveryKey} disabled={disabled}
          onChange={(event) => connection.setRecoveryKey(event.target.value)} />
        <FieldDescription>加入已有同步库时需要恢复密钥；创建新库时留空。</FieldDescription>
      </Field>
      {connection.error && !connection.plan && <FieldError role="alert">{connection.error}</FieldError>}
      <Button type="button" variant="outline" disabled={disabled || !connection.url || !connection.username || !connection.password}
        onClick={() => void connection.prepare()}>
        {busy ? '正在检查…' : '检查连接'}
      </Button>
    </FieldGroup>
  );
}
