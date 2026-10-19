import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { BUILT_IN_ENGINES } from '@/domain/search-engines';
import type { SearchEngine } from '@/domain/search-engines';
import { useData } from '@/app/data-context';

function EngineKeywordField({ engine }: { readonly engine: SearchEngine }) {
  const { settings, setSearchEngineKeyword } = useData();
  const savedKeyword = settings.search.customization.engineKeywords[engine.id] ?? '';
  const [keyword, setKeyword] = useState(savedKeyword);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setKeyword(savedKeyword), [savedKeyword]);
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await setSearchEngineKeyword(engine.id, keyword);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Field data-invalid={error !== null || undefined}>
      <FieldLabel htmlFor={`engine-keyword-${engine.id}`}>搜索关键词</FieldLabel>
      <div className="flex min-w-0 gap-2">
        <Input id={`engine-keyword-${engine.id}`} aria-label={`${engine.name} 搜索关键词`} value={keyword}
          placeholder="未设置" aria-invalid={Boolean(error)}
          onChange={(event) => { setKeyword(event.target.value); setSaved(false); }} />
        <Button type="button" variant="outline" onClick={() => void save()}>保存关键词</Button>
      </div>
      <FieldDescription>在主页输入关键词和空格，可直接使用此搜索引擎。</FieldDescription>
      {saved && <FieldDescription role="status">已保存</FieldDescription>}
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}

function CustomEngineFields({ engine }: { readonly engine: SearchEngine }) {
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
    <FieldGroup className="gap-3">
      <Field data-invalid={error !== null || undefined}>
        <FieldLabel htmlFor={`engine-name-${engine.id}`}>名称</FieldLabel>
        <Input id={`engine-name-${engine.id}`} aria-label={`${engine.name} 名称`}
          value={name} onChange={(event) => setName(event.target.value)} />
        <FieldLabel htmlFor={`engine-template-${engine.id}`}>HTTPS 搜索模板</FieldLabel>
        <Input id={`engine-template-${engine.id}`} aria-label={`${engine.name} HTTPS 搜索模板`}
          value={template} onChange={(event) => setTemplate(event.target.value)} />
        {error && <FieldError role="alert">{error}</FieldError>}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void save()}>保存搜索引擎</Button>
        <Button type="button" variant="destructive" aria-label={`删除 ${engine.name}`}
          disabled={selected} onClick={() => void remove()}>删除搜索引擎</Button>
      </div>
      {selected && <p className="text-xs text-muted-foreground">请先切换默认搜索引擎，再删除此项。</p>}
    </FieldGroup>
  );
}

function EngineSettingsRow({ engine }: { readonly engine: SearchEngine }) {
  return (
    <section aria-label={`${engine.name} 搜索设置`} className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/50 bg-muted/20 p-3 sm:p-4">
      <h4 className="font-medium">{engine.name}{engine.builtIn ? ' · 内置' : ''}</h4>
      <EngineKeywordField engine={engine} />
      {!engine.builtIn && <CustomEngineFields engine={engine} />}
    </section>
  );
}

export function CustomEngineList() {
  const { settings } = useData();
  const engines = [...BUILT_IN_ENGINES, ...settings.search.customEngines];
  return <div className="flex min-w-0 flex-col gap-4">{engines.map((engine) => <EngineSettingsRow key={engine.id} engine={engine} />)}</div>;
}
