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
    <div className="flex flex-col gap-4">
      <WebDavCredentialsForm connection={connection} />
      <WebDavPlanReview connection={connection} />
    </div>
  );
}
