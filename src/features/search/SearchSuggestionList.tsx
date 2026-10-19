import { ArrowUpRightIcon, CircleAlertIcon, CopyIcon, FolderIcon, SearchIcon, WandSparklesIcon } from 'lucide-react';
import type { SearchFormProps } from '@/features/search/SearchForm';
import { searchActionName, type SearchSuggestion } from '@/features/search/search-model';

const SECTION_NAMES = { tool: '快捷工具', search: '网页搜索', site: '网站', folder: '文件夹', navigation: '网址', status: '本地检索' } as const;

function ResultIcon({ item }: { readonly item: SearchSuggestion }) {
  if (item.swatch) return <span aria-label={`颜色 ${item.swatch}`} className="size-7 shrink-0 rounded-md border border-border"
    style={{ backgroundColor: item.swatch }} />;
  if (item.contrast) return <span aria-label="文字对比预览" className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-sm"
    style={{ color: item.contrast.foreground, backgroundColor: item.contrast.background }}>Aa</span>;
  if (item.kind === 'copy') return <CopyIcon className="size-4 shrink-0" />;
  if (item.kind === 'fill') return <WandSparklesIcon className="size-4 shrink-0" />;
  if (item.kind === 'error') return <CircleAlertIcon className="size-4 shrink-0" />;
  if (item.kind === 'search') return <SearchIcon className="size-4 shrink-0" />;
  return item.kind === 'folder' ? <FolderIcon className="size-4 shrink-0" /> : <ArrowUpRightIcon className="size-4 shrink-0" />;
}

function ResultContent({ item }: { readonly item: SearchSuggestion }) {
  const answer = item.kind === 'copy';
  return <>
    <ResultIcon item={item} />
    <span className="min-w-0 flex-1">
      <span className={answer ? 'block break-words text-lg font-medium tabular-nums' : 'block truncate text-sm'}>
        {answer ? item.value : item.label}
      </span>
      <span className={answer ? 'block break-words text-xs text-muted-foreground' : 'block truncate text-xs text-muted-foreground'}>
        {answer ? `${item.label}${item.detail !== item.value ? ` · ${item.detail}` : ''}` : item.detail}
      </span>
    </span>
    <span className="shrink-0 text-xs text-muted-foreground">{searchActionName(item)}</span>
  </>;
}

export function SearchSuggestionList({ input }: { readonly input: SearchFormProps }) {
  return <div className="absolute top-[calc(100%+0.5rem)] left-0 w-full overflow-hidden rounded-2xl border border-border/60 bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-xl">
    <div id="search-suggestions" role="listbox" aria-label="搜索结果" className="max-h-80 overflow-y-auto p-1.5">
      {input.suggestions.map((item, index) => <div key={item.id}>
        {(index === 0 || input.suggestions[index - 1]!.section !== item.section) &&
          <div role="presentation" className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{SECTION_NAMES[item.section]}</div>}
        <button id={`search-option-${item.id}`} type="button" role="option" aria-selected={index === input.activeIndex}
          disabled={item.kind === 'status'} onMouseDown={(event) => event.preventDefault()} onClick={() => input.execute(item)}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none aria-selected:bg-accent aria-selected:text-accent-foreground disabled:opacity-60">
          <ResultContent item={item} />
        </button>
      </div>)}
    </div>
    <p className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
      <kbd>↑</kbd><kbd>↓</kbd><span>选择</span><kbd>Enter</kbd><span>{searchActionName(input.suggestions[input.activeIndex])}</span>
      <kbd>Esc</kbd><span>关闭</span>
    </p>
  </div>;
}
