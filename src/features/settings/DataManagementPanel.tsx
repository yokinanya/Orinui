import { SettingsSection } from '@/features/settings/SettingsSection';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { ResetDataPanel } from '@/features/settings/ResetDataPanel';
import { WebDavSyncPanel } from '@/features/settings/WebDavSyncPanel';
import { S3SyncPanel } from '@/features/settings/S3SyncPanel';
import { SyncSettingsDisclosure } from '@/features/settings/SyncSettingsDisclosure';
import { useWebDavSync } from '@/app/webdav-sync-context';
import { useS3Sync } from '@/app/s3-sync-context';

export function DataManagementPanel() {
  const webDav = useWebDavSync();
  const s3 = useS3Sync();
  return (
    <div className="settings-columns settings-data-columns grid items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsSection title="完整备份"><BackupPanel /></SettingsSection>
        <SettingsSection title="本地数据"><ResetDataPanel /></SettingsSection>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsSection title="WebDAV 同步">
          <SyncSettingsDisclosure connection={webDav}><WebDavSyncPanel /></SyncSettingsDisclosure>
        </SettingsSection>
        <SettingsSection title="S3 兼容存储">
          <SyncSettingsDisclosure connection={s3}><S3SyncPanel /></SyncSettingsDisclosure>
        </SettingsSection>
      </div>
    </div>
  );
}
