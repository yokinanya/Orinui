import { FieldGroup } from '@/components/ui/field';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/features/settings/SettingsSection';
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

function EngineManagement({ onBack }: { readonly onBack: () => void }) {
  const { settings } = useData();
  return (
    <div className="flex flex-col gap-5">
      <Button autoFocus variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />返回搜索
      </Button>
      <SettingsSection title="自定义搜索引擎"><CustomEngineForm /></SettingsSection>
      {settings.search.customEngines.length > 0 && <SettingsSection title="已添加的引擎"><CustomEngineList /></SettingsSection>}
    </div>
  );
}

export function SearchSettingsPanel() {
  const [managingEngines, setManagingEngines] = useState(false);
  const managementTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!managingEngines && restoreFocus.current) {
      managementTrigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [managingEngines]);
  const returnToSearch = () => {
    restoreFocus.current = true;
    setManagingEngines(false);
  };
  const { settings, setDefaultEngine, updateSearchPreferences } = useData();
  const update = (patch: Parameters<typeof updateSearchPreferences>[0]) =>
    void updateSearchPreferences(patch).catch(notifyError);
  if (managingEngines) return <EngineManagement onBack={returnToSearch} />;
  return (
    <div className="settings-columns grid items-start gap-4">
    <SettingsSection title="搜索行为">
    <FieldGroup>
      <SettingsChoiceField responsive label="搜索框宽度" value={settings.search.width} options={WIDTH_OPTIONS}
        onChange={(width) => update({ width })} />
      <SettingsSwitchField label="打开主页时聚焦搜索" checked={settings.search.autoFocus}
        onChange={(autoFocus) => update({ autoFocus })} />
      <SettingsChoiceField responsive label="搜索结果打开方式" value={settings.search.openTarget} options={TARGET_OPTIONS}
        onChange={(openTarget) => update({ openTarget })} />
    </FieldGroup>
    </SettingsSection>
    <SettingsSection title="搜索引擎">
      <EngineSelection engines={settings.search.customEngines} selected={settings.search.defaultEngineId}
        onSelect={(id) => void setDefaultEngine(id).catch(notifyError)} />
      <Button ref={managementTrigger} variant="outline" className="justify-between" onClick={() => setManagingEngines(true)}>
        管理自定义搜索引擎<ArrowRight data-icon="inline-end" />
      </Button>
      <p className="text-sm text-muted-foreground">输入时仅搜索本地网站和文件夹。</p>
    </SettingsSection>
    </div>
  );
}
