import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { useData } from '@/app/data-context';
import { CustomEngineForm } from '@/features/settings/CustomEngineForm';
import { CustomEngineList } from '@/features/settings/CustomEngineList';
import { EngineSelection } from '@/features/settings/EngineSelection';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import type { OpenTarget } from '@/domain/settings';
import { notifyError } from '@/lib/notify';

const WIDTH_OPTIONS: readonly ChoiceOption<'narrow' | 'standard' | 'wide'>[] = [
  { value: 'narrow', label: '窄' }, { value: 'standard', label: '标准' }, { value: 'wide', label: '宽' },
];
const TARGET_OPTIONS: readonly ChoiceOption<OpenTarget>[] = [
  { value: 'current-tab', label: '当前页' }, { value: 'new-tab', label: '新标签页' },
];

export function SearchSettingsPanel() {
  const { settings, setDefaultEngine, updateSearchPreferences } = useData();
  const update = (patch: Parameters<typeof updateSearchPreferences>[0]) =>
    void updateSearchPreferences(patch).catch(notifyError);
  return (
    <FieldGroup>
      <SettingsChoiceField label="搜索框宽度" value={settings.search.width} options={WIDTH_OPTIONS}
        onChange={(width) => update({ width })} />
      <SettingsSwitchField label="打开主页时聚焦搜索" checked={settings.search.autoFocus}
        onChange={(autoFocus) => update({ autoFocus })} />
      <SettingsChoiceField label="搜索结果打开方式" value={settings.search.openTarget} options={TARGET_OPTIONS}
        onChange={(openTarget) => update({ openTarget })} />
      <EngineSelection engines={settings.search.customEngines} selected={settings.search.defaultEngineId}
        onSelect={(id) => void setDefaultEngine(id).catch(notifyError)} />
      <Separator />
      <CustomEngineForm />
      {settings.search.customEngines.length > 0 && <><Separator /><CustomEngineList /></>}
      <p className="text-sm text-muted-foreground">搜索建议未开启，输入内容不会发送给建议服务。</p>
    </FieldGroup>
  );
}
