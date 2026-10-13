import { Separator } from '@/components/ui/separator';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { ResetDataPanel } from '@/features/settings/ResetDataPanel';
import { WebDavSyncPanel } from '@/features/settings/WebDavSyncPanel';

export function DataManagementPanel() {
  return <div className="flex flex-col gap-6"><BackupPanel /><Separator /><WebDavSyncPanel /><Separator /><ResetDataPanel /></div>;
}
