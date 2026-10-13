import { FieldDescription } from '@/components/ui/field';
import { WebDavConnectedPanel } from '@/features/settings/WebDavConnectedPanel';
import { WebDavCredentialsForm } from '@/features/settings/WebDavCredentialsForm';
import { WebDavPlanReview } from '@/features/settings/WebDavPlanReview';
import { useWebDavConnection } from '@/features/settings/use-webdav-connection';

export function WebDavSyncPanel() {
  const connection = useWebDavConnection();

  if (connection.loading && !connection.status) {
    return <FieldDescription role="status">正在读取同步状态…</FieldDescription>;
  }

  if (connection.status) return <WebDavConnectedPanel connection={connection} />;

  return (
    <section aria-labelledby="webdav-sync-title" className="flex flex-col gap-4">
      <div>
        <h3 id="webdav-sync-title" className="text-sm font-medium">WebDAV 同步</h3>
        <p className="mt-1 text-sm text-muted-foreground">连接自己的 HTTPS WebDAV 存储。云端内容使用端到端加密。</p>
      </div>
      <WebDavCredentialsForm connection={connection} />
      <WebDavPlanReview connection={connection} />
    </section>
  );
}
