import { SettingsSection } from '@/features/settings/SettingsSection';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { ResetDataPanel } from '@/features/settings/ResetDataPanel';
import { WebDavSyncPanel } from '@/features/settings/WebDavSyncPanel';
import { S3SyncPanel } from '@/features/settings/S3SyncPanel';

export function DataManagementPanel() {
  return (
    <div className="settings-columns settings-data-columns grid items-start gap-4">
      <SettingsSection title="完整备份"><BackupPanel /></SettingsSection>
      <SettingsSection title="WebDAV 同步"><WebDavSyncPanel /></SettingsSection>
      <SettingsSection title="S3 兼容存储"><S3SyncPanel /></SettingsSection>
      <SettingsSection title="本地数据"><ResetDataPanel /></SettingsSection>
    </div>
  );
}
