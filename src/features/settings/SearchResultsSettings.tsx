import { useData } from '@/app/data-context';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import { notifyError } from '@/lib/notify';

const TOOL_OPTIONS = [
  { id: 'calculation', label: '计算与单位换算' },
  { id: 'datetime', label: '日期与时间' },
  { id: 'color', label: '颜色与对比度' },
  { id: 'github', label: 'GitHub 命令' },
] as const;

export function SearchResultsSettings() {
  const { settings, updateSearchCustomization, setSearchToolEnabled } = useData();
  const { customization } = settings.search;
  const save = (patch: Parameters<typeof updateSearchCustomization>[0]) => void updateSearchCustomization(patch).catch(notifyError);
  return (
    <FieldGroup className="gap-3">
      <SettingsSwitchField label="显示网站结果" checked={customization.showSites}
        onChange={(showSites) => save({ showSites })} />
      <SettingsSwitchField label="显示文件夹结果" checked={customization.showFolders}
        onChange={(showFolders) => save({ showFolders })} />
      <FieldSet className="min-w-0 gap-3 border-t border-border/50 pt-3">
        <FieldLegend variant="label" className="mb-0">快捷工具</FieldLegend>
        {TOOL_OPTIONS.map(({ id, label }) => <SettingsSwitchField key={id} label={label}
          checked={customization.enabledTools.includes(id)}
          onChange={(enabled) => void setSearchToolEnabled(id, enabled).catch(notifyError)} />)}
      </FieldSet>
    </FieldGroup>
  );
}
