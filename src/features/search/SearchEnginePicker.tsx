import { GlobeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { resolveEngine, resolveEngines } from '@/domain/search-engines';
import type { BuiltInEngineOverrides } from '@/domain/search-engines';
import type { AppSettings } from '@/domain/settings';
import { notifyError } from '@/lib/notify';

function EngineIcon({ id }: { readonly id: string }) {
  if (id === 'google') return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.7h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.4ZM12 22c2.7 0 5-.9 6.7-2.4L15.4 17c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22ZM6.4 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.4-2.7ZM12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.7A6 6 0 0 1 12 6.1Z" /></svg>;
  if (id === 'bing') return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 2v16.5L10 22l10-5.7v-5.5L10 7.5l2.2 5.4 3.3 1.5-5.5 3.1V4Z" /></svg>;
  if (id === 'duckduckgo') return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="10"/><path d="M9 17V8c0-3 6-3 6 0v3l5 1-5 2v3M8 18l4 2 4-2"/><circle cx="13" cy="8" r=".6"/></svg>;
  return <GlobeIcon />;
}

export function SearchEnginePicker({ engineId, engines, overrides, setDefaultEngine }: {
  readonly engineId: string;
  readonly engines: readonly AppSettings['search']['customEngines'][number][];
  readonly overrides: BuiltInEngineOverrides;
  readonly setDefaultEngine: (id: string) => Promise<void>;
}) {
  const selected = resolveEngine(engineId, engines, overrides);
  const allEngines = resolveEngines(engines, overrides);
  if (!selected) return <span role="alert">搜索引擎不存在</span>;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button"     variant="ghost" size="icon-sm" aria-label="选择搜索引擎"
          title={`搜索引擎：${selected.name}`} className="search-engine-trigger home-readable-muted home-readable-focus rounded-lg" />}>
      <EngineIcon id={selected.id} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuRadioGroup value={engineId} onValueChange={(id) => void setDefaultEngine(id).catch(notifyError)}>
        {allEngines.map((engine) => <DropdownMenuRadioItem key={engine.id} value={engine.id}>
          <EngineIcon id={engine.id} />{engine.name}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
