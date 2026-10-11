import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { SearchEngine } from '@/domain/search-engines';
import { useData } from '@/app/data-context';

function CustomEngineRow({ engine }: { readonly engine: SearchEngine }) {
  const { settings, updateSearchEngine, deleteSearchEngine } = useData();
  const [name, setName] = useState(engine.name);
  const [template, setTemplate] = useState(engine.template);
  const [error, setError] = useState<string | null>(null);
  const selected = settings.search.defaultEngineId === engine.id;
  const save = async () => {
    setError(null);
    try { await updateSearchEngine(engine.id, { name, template }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const remove = async () => {
    setError(null);
    try { await deleteSearchEngine(engine.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <FieldGroup>
      <Field>
        <Input aria-label={`${engine.name} 名称`} value={name} onChange={(event) => setName(event.target.value)} />
        <Input aria-label={`${engine.name} 模板`} value={template} onChange={(event) => setTemplate(event.target.value)} />
        {error && <FieldError role="alert">{error}</FieldError>}
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void save()}>保存 {engine.name}</Button>
        <Button type="button" variant="destructive" disabled={selected} onClick={() => void remove()}>删除 {engine.name}</Button>
      </div>
      {selected && <p className="text-xs text-muted-foreground">请先切换默认搜索引擎，再删除此项。</p>}
    </FieldGroup>
  );
}

export function CustomEngineList() {
  const { settings } = useData();
  return <div className="flex flex-col gap-4">{settings.search.customEngines.map((engine) => <CustomEngineRow key={engine.id} engine={engine} />)}</div>;
}
