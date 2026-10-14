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
      <h3 id="webdav-sync-title" className="text-sm font-medium">WebDAV 同步</h3>
      <WebDavCredentialsForm connection={connection} />
      <WebDavPlanReview connection={connection} />
    </section>
  );
}
