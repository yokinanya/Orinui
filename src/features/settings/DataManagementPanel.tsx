import { Separator } from '@/components/ui/separator';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { ResetDataPanel } from '@/features/settings/ResetDataPanel';

export function DataManagementPanel() {
  return <div className="flex flex-col gap-6"><BackupPanel /><Separator /><ResetDataPanel /></div>;
}
