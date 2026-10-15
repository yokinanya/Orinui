import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import type { OpenTarget } from '@/domain/settings';
import { ClockSettingsPanel } from '@/features/settings/ClockSettingsPanel';
import { LayoutSlotList } from '@/features/settings/LayoutSlotList';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import { notifyError } from '@/lib/notify';

const WIDTH_OPTIONS: readonly ChoiceOption<'compact' | 'standard' | 'wide'>[] = [
  { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'wide', label: '宽阔' },
];
const GAP_OPTIONS: readonly ChoiceOption<'compact' | 'standard' | 'relaxed'>[] = [
  { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'relaxed', label: '宽松' },
];
const COLUMN_OPTIONS: readonly ChoiceOption<'4' | '6' | '8'>[] = [
  { value: '4', label: '4 列' }, { value: '6', label: '6 列' }, { value: '8', label: '8 列' },
];
const TARGET_OPTIONS: readonly ChoiceOption<OpenTarget>[] = [
  { value: 'current-tab', label: '当前页' }, { value: 'new-tab', label: '新标签页' },
];

function LayoutSection({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h3 id={id} className="text-base font-semibold">{title}</h3>
      <div className="w-full max-w-xl">{children}</div>
    </section>
  );
}

function PageSettings() {
  const { settings, updateLayout } = useData();
  const { layout } = settings;
  const update = (patch: Partial<typeof layout>) => void updateLayout(patch).catch(notifyError);
  return (
    <LayoutSection id="layout-page-heading" title="页面">
      <FieldGroup className="gap-4">
        <SettingsChoiceField responsive label="页面宽度" value={layout.pageWidth} options={WIDTH_OPTIONS}
          onChange={(pageWidth) => update({ pageWidth })} />
        <SettingsChoiceField responsive label="区域间距" value={layout.regionSpacing} options={GAP_OPTIONS}
          onChange={(regionSpacing) => update({ regionSpacing })} />
        <LayoutSlotList />
      </FieldGroup>
    </LayoutSection>
  );
}

function WebsiteSettings() {
  const { settings, updateLayout, updateShortcutPreferences } = useData();
  const { layout, shortcuts } = settings;
  const update = (patch: Partial<typeof layout>) => void updateLayout(patch).catch(notifyError);
  const updateShortcut = (patch: Partial<typeof shortcuts>) => void updateShortcutPreferences(patch).catch(notifyError);
  return (
    <LayoutSection id="layout-shortcuts-heading" title="网站">
      <FieldGroup className="gap-4">
        <SettingsChoiceField responsive label="网格最大列数" value={String(layout.columns) as '4' | '6' | '8'} options={COLUMN_OPTIONS}
          onChange={(columns) => update({ columns: Number(columns) as 4 | 6 | 8 })} />
        <SettingsSwitchField label="显示网站名称" checked={shortcuts.showNames}
          onChange={(showNames) => updateShortcut({ showNames })} />
        <SettingsChoiceField responsive label="网站打开方式" value={shortcuts.openTarget} options={TARGET_OPTIONS}
          onChange={(openTarget) => updateShortcut({ openTarget })} />
      </FieldGroup>
    </LayoutSection>
  );
}

export function LayoutPanel() {
  const { resetLayout } = useData();
  return (
    <div className="flex flex-col gap-6 pb-2">
      <PageSettings />
      <Separator />
      <LayoutSection id="layout-clock-heading" title="时钟"><ClockSettingsPanel /></LayoutSection>
      <Separator />
      <WebsiteSettings />
      <Separator />
      <Button type="button" variant="outline" size="sm" className="self-start"
        onClick={() => void resetLayout().catch(notifyError)}>
        恢复默认布局
      </Button>
    </div>
  );
}
