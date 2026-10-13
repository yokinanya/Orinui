import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { useData } from '@/app/data-context';
import { CustomEngineForm } from '@/features/settings/CustomEngineForm';
import { CustomEngineList } from '@/features/settings/CustomEngineList';
import { EngineSelection } from '@/features/settings/EngineSelection';
import { notifyError } from '@/lib/notify';

export function SearchSettingsPanel() {
  const { settings, setDefaultEngine } = useData();
  return (
    <FieldGroup>
      <EngineSelection engines={settings.search.customEngines} selected={settings.search.defaultEngineId}
        onSelect={(id) => void setDefaultEngine(id).catch(notifyError)} />
      <Separator />
      <CustomEngineForm />
      {settings.search.customEngines.length > 0 && <><Separator /><CustomEngineList /></>}
      <p className="text-sm text-muted-foreground">搜索建议未开启，输入内容不会发送给建议服务。</p>
    </FieldGroup>
  );
}
