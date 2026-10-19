import { FieldGroup } from '@/components/ui/field';
import { useData } from '@/app/data-context';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import type { OpenTarget } from '@/domain/settings';
import { notifyError } from '@/lib/notify';

const TARGET_OPTIONS: readonly ChoiceOption<OpenTarget>[] = [
  { value: 'current-tab', label: '当前页' }, { value: 'new-tab', label: '新标签页' },
];

export function SearchBehaviorSettings() {
  const { settings, updateSearchPreferences } = useData();
  const update = (patch: Parameters<typeof updateSearchPreferences>[0]) => void updateSearchPreferences(patch).catch(notifyError);
  return (
    <FieldGroup className="gap-4">
      <SettingsSwitchField label="打开主页时聚焦搜索" checked={settings.search.autoFocus}
        onChange={(autoFocus) => update({ autoFocus })} />
      <SettingsChoiceField responsive label="搜索结果打开方式" value={settings.search.openTarget} options={TARGET_OPTIONS}
        onChange={(openTarget) => update({ openTarget })} />
    </FieldGroup>
  );
}
