import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { BUILT_IN_ENGINES, resolveEngines } from '@/domain/search-engines';
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
      <FieldLabel htmlFor={`engine-keyword-${engine.id}`}>快捷词（可选）</FieldLabel>
      <div className="flex min-w-0 gap-2">
        <Input id={`engine-keyword-${engine.id}`} aria-label={`${engine.name} 快捷词`} value={keyword}
          placeholder="未设置" aria-invalid={Boolean(error)}
          onChange={(event) => { setKeyword(event.target.value); setSaved(false); }} />
        <Button type="button" variant="outline" onClick={() => void save()}>保存快捷词</Button>
      </div>
      {saved && <FieldDescription role="status" aria-label={`${engine.name}关键词保存状态`}>已保存</FieldDescription>}
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}

function EngineFields({ engine }: { readonly engine: SearchEngine }) {
  const { settings, updateSearchEngine, deleteSearchEngine } = useData();
  const [name, setName] = useState(engine.name);
  const [template, setTemplate] = useState(engine.template);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selected = settings.search.defaultEngineId === engine.id;
  const preset = engine.builtIn ? BUILT_IN_ENGINES.find(({ id }) => id === engine.id) : undefined;
  const hasOverride = Boolean(settings.search.customization.engineOverrides[engine.id]);
  useEffect(() => { setName(engine.name); setTemplate(engine.template); }, [engine.name, engine.template]);
  const save = async () => {
    setError(null);
    setSaved(false);
    try { await updateSearchEngine(engine.id, { name, template }); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const reset = async () => {
    if (!preset) return;
    setError(null);
    setSaved(false);
    try { await updateSearchEngine(engine.id, { name: preset.name, template: preset.template }); setSaved(true); }
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
          value={name} onChange={(event) => { setName(event.target.value); setError(null); setSaved(false); }} />
        <FieldLabel htmlFor={`engine-template-${engine.id}`}>HTTPS 搜索模板</FieldLabel>
        <Input id={`engine-template-${engine.id}`} aria-label={`${engine.name} HTTPS 搜索模板`}
          value={template} onChange={(event) => { setTemplate(event.target.value); setError(null); setSaved(false); }} />
        {error && <FieldError role="alert">{error}</FieldError>}
      </Field>
      {saved && <p role="status" aria-label={`${engine.name}引擎保存状态`} className="text-xs text-muted-foreground">已保存</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void save()}>保存搜索引擎</Button>
        {preset ? <Button type="button" variant="outline" disabled={!hasOverride} onClick={() => void reset()}>
          恢复预置设置
        </Button> : <Button type="button" variant="destructive" aria-label={`删除 ${engine.name}`}
          disabled={selected} onClick={() => void remove()}>删除搜索引擎</Button>}
      </div>
      {selected && <p className="text-xs text-muted-foreground">请先切换默认搜索引擎，再删除此项。</p>}
    </FieldGroup>
  );
}

function EngineSettingsRow({ engine, keyword, isDefault, expanded, onToggle, showSeparator }: {
  readonly engine: SearchEngine;
  readonly keyword: string;
  readonly isDefault: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly showSeparator: boolean;
}) {
  return (
    <li className="min-w-0">
      <Button type="button" variant="ghost" aria-label={`${engine.name} 搜索引擎设置`}
        aria-expanded={expanded} className="h-auto w-full justify-between rounded-none px-3 py-3 text-left"
        onClick={onToggle}>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-full truncate font-medium">{engine.name}</span>
            <Badge variant={engine.builtIn ? 'secondary' : 'outline'}>{engine.builtIn ? '预置' : '自定义'}</Badge>
            {isDefault && <Badge variant="outline">默认</Badge>}
          </span>
          <span className="text-xs text-muted-foreground">{keyword ? `快捷词：${keyword}` : '未设置快捷词'}</span>
        </span>
        {expanded ? <ChevronDown data-icon="inline-end" /> : <ChevronRight data-icon="inline-end" />}
      </Button>
      {expanded && (
        <section aria-label={`${engine.name} 搜索设置`} className="flex min-w-0 flex-col gap-4 px-3 pb-4 pt-1">
          <Separator />
          <EngineKeywordField engine={engine} />
          <Separator />
          <EngineFields engine={engine} />
        </section>
      )}
      {showSeparator && <Separator />}
    </li>
  );
}

export function CustomEngineList() {
  const { settings } = useData();
  const [expandedEngineId, setExpandedEngineId] = useState<string | null>(null);
  const engines = resolveEngines(settings.search.customEngines, settings.search.customization.engineOverrides);
  return (
    <ul className="min-w-0 overflow-hidden rounded-lg border border-border/50 bg-background/30">
      {engines.map((engine, index) => <EngineSettingsRow key={engine.id} engine={engine}
        keyword={settings.search.customization.engineKeywords[engine.id] ?? ''}
        isDefault={settings.search.defaultEngineId === engine.id} expanded={expandedEngineId === engine.id}
        showSeparator={index < engines.length - 1}
        onToggle={() => setExpandedEngineId((current) => current === engine.id ? null : engine.id)} />)}
    </ul>
  );
}
