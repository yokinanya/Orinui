import { SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { buildSearchUrl, resolveEngine } from '@/domain/search-engines';
import { openInCurrentTab } from '@/platform/navigation';
import { useData } from '@/app/data-context';
import { notifyError } from '@/lib/notify';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * 主页搜索入口。
 *
 * 视觉规格：宽而克制的半透明磨砂输入框，聚焦时保持表面，不添加底部线条。
 * 初始不自动聚焦，点击或按 `/` 聚焦；搜索建议默认关闭，因此本阶段不发起任何网络请求。
 */
export function SearchField() {
  const { settings } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = () => {
    const trimmed = query.trim();
    if (trimmed === '') return;
    const engine = resolveEngine(settings.search.defaultEngineId, settings.search.customEngines);
    if (!engine) throw new Error('默认搜索引擎不存在');
    try { openInCurrentTab(buildSearchUrl(engine, trimmed)); }
    catch (error) { notifyError(error); }
  };

  return (
    <form
      role="search"
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup className="home-readable-surface h-12 rounded-2xl border border-primary/30 backdrop-blur-md"
        style={{ backgroundColor: 'var(--home-readable-search-surface, var(--glass))' }}>
        <InputGroupAddon className="pl-4">
          <SearchIcon className="home-readable-muted text-glass-foreground-muted" />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索"
          aria-label="搜索"
          className="home-readable-ink h-12 text-base text-glass-foreground placeholder:text-glass-foreground-muted md:text-base"
        />
      </InputGroup>
    </form>
  );
}
