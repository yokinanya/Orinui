import type { ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { SettingsSection } from '@/features/settings/SettingsSection';
import type { OpenTarget } from '@/domain/settings';
import { ClockSettingsPanel } from '@/features/settings/ClockSettingsPanel';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import { notifyError } from '@/lib/notify';

const WIDTH_OPTIONS: readonly ChoiceOption<'compact' | 'standard' | 'wide'>[] = [
  { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'wide', label: '宽阔' },
];
const GAP_OPTIONS: readonly ChoiceOption<'compact' | 'standard' | 'relaxed'>[] = [
  { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'relaxed', label: '宽松' },
];
const TARGET_OPTIONS: readonly ChoiceOption<OpenTarget>[] = [
  { value: 'current-tab', label: '当前页' }, { value: 'new-tab', label: '新标签页' },
];

function LayoutSection({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <SettingsSection title={title}>
      <div id={id} className="w-full min-w-0">{children}</div>
    </SettingsSection>
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
        {(['clock', 'search', 'shortcuts'] as const).map((slot) => <SettingsSwitchField key={slot}
          label={{ clock: '显示时钟', search: '显示搜索', shortcuts: '显示主页内容' }[slot]}
          checked={!layout.hidden.includes(slot)} onChange={(shown) => update({ hidden: shown
            ? layout.hidden.filter((item) => item !== slot) : [...layout.hidden, slot] })} />) }
      </FieldGroup>
    </LayoutSection>
  );
}

function WebsiteSettings() {
  const { settings, updateShortcutPreferences } = useData();
  const { shortcuts } = settings;
  const updateShortcut = (patch: Partial<typeof shortcuts>) => void updateShortcutPreferences(patch).catch(notifyError);
  return (
    <LayoutSection id="layout-shortcuts-heading" title="网站">
      <FieldGroup className="gap-4">
        <SettingsChoiceField responsive label="网站打开方式" value={shortcuts.openTarget} options={TARGET_OPTIONS}
          onChange={(openTarget) => updateShortcut({ openTarget })} />
      </FieldGroup>
    </LayoutSection>
  );
}

export function LayoutPanel() {
  const { resetLayout } = useData();
  return (
    <div className="settings-columns settings-layout-columns grid items-start gap-4 pb-2">
      <div className="flex min-w-0 flex-col gap-4">
        <PageSettings />
        <Button type="button" variant="outline" size="sm" className="self-start"
          onClick={() => void resetLayout().catch(notifyError)}>
          恢复默认布局
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <LayoutSection id="layout-clock-heading" title="时钟"><ClockSettingsPanel /></LayoutSection>
        <WebsiteSettings />
      </div>
    </div>
  );
}
