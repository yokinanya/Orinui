import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useData } from '@/app/data-context';
import { CustomEngineForm } from '@/features/settings/CustomEngineForm';
import { CustomEngineList } from '@/features/settings/CustomEngineList';
import { EngineSelection } from '@/features/settings/EngineSelection';
import { SearchBehaviorSettings } from '@/features/settings/SearchBehaviorSettings';
import { SearchBoxSettings } from '@/features/settings/SearchBoxSettings';
import { SearchResultsSettings } from '@/features/settings/SearchResultsSettings';
import { notifyError } from '@/lib/notify';

function EngineManagement({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Button autoFocus variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />返回搜索
      </Button>
      <SettingsSection title="添加自定义搜索引擎"><CustomEngineForm /></SettingsSection>
      <SettingsSection title="搜索引擎关键词与管理" description="为内置或自定义引擎设置关键词；内置引擎名称和模板固定。">
        <CustomEngineList />
      </SettingsSection>
    </div>
  );
}

function SearchSettingsHome({ onManage, managementTrigger }: {
  readonly onManage: () => void;
  readonly managementTrigger: RefObject<HTMLButtonElement | null>;
}) {
  const { settings, setDefaultEngine } = useData();
  return (
    <div className="settings-columns grid min-w-0 items-start gap-4">
      <SettingsSection title="搜索框"><SearchBoxSettings /></SettingsSection>
      <SettingsSection title="搜索行为"><SearchBehaviorSettings /></SettingsSection>
      <SettingsSection title="结果内容"><SearchResultsSettings /></SettingsSection>
      <SettingsSection title="搜索引擎" description="输入时仅搜索本地网站和文件夹。">
        <EngineSelection engines={settings.search.customEngines} selected={settings.search.defaultEngineId}
          onSelect={(id) => void setDefaultEngine(id).catch(notifyError)} />
        <Button ref={managementTrigger} variant="outline" className="w-full justify-between" onClick={onManage}>
          管理自定义搜索引擎<ArrowRight data-icon="inline-end" />
        </Button>
      </SettingsSection>
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
  if (managingEngines) return <EngineManagement onBack={returnToSearch} />;
  return <SearchSettingsHome managementTrigger={managementTrigger} onManage={() => setManagingEngines(true)} />;
}
