import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { BackgroundPanel } from '@/features/settings/BackgroundPanel';
import { DynamicColorPanel } from '@/features/settings/DynamicColorPanel';
import { ThemePanel } from '@/features/settings/ThemePanel';

export function AppearancePanel() {
  return (
    <FieldGroup>
      <ThemePanel />
      <Separator />
      <BackgroundPanel />
      <Separator />
      <DynamicColorPanel />
    </FieldGroup>
  );
}
