import { ExternalLinkIcon } from 'lucide-react';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { BackgroundPanel } from '@/features/settings/BackgroundPanel';
import { DynamicColorPanel } from '@/features/settings/DynamicColorPanel';
import { ThemePanel } from '@/features/settings/ThemePanel';

export function AppearancePanel() {
  return (
    <FieldGroup>
      <ThemePanel />
      <Separator />
      <Field>
        <FieldLabel>图标目录参考</FieldLabel>
        <FieldDescription>在目录中选择图标并复制图片直链，再到网站编辑表单中下载到本机。</FieldDescription>
        <a href="https://dashboardicons.com/icons" target="_blank" rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
          Dashboard Icons <ExternalLinkIcon aria-hidden="true" className="size-4" />
        </a>
      </Field>
      <Separator />
      <BackgroundPanel />
      <Separator />
      <DynamicColorPanel />
    </FieldGroup>
  );
}
