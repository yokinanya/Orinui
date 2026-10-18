import { ArrowUpRightIcon, CalculatorIcon, CopyIcon, FolderIcon, SearchIcon } from 'lucide-react';
import type { SearchFormProps, Suggestion } from '@/features/search/SearchField';

function groupName(item: Suggestion): string {
  if (item.id.startsWith('tool:')) return '快捷工具';
  if (item.kind === 'search') return '网页搜索';
  return item.kind === 'folder' ? '文件夹' : '网站';
}

function actionName(item: Suggestion | undefined): string {
  if (item?.kind === 'copy') return '复制';
  if (item?.kind === 'search') return '搜索';
  return item?.kind === 'error' ? '查看错误' : '打开';
}

function ResultContent({ item }: { readonly item: Suggestion }) {
  const answer = item.kind === 'copy';
  return <>
    {answer ? <CopyIcon className="size-4 shrink-0" /> : item.kind === 'search' ? <SearchIcon className="size-4 shrink-0" />
      : item.kind === 'folder' ? <FolderIcon className="size-4 shrink-0" /> : item.kind === 'error'
        ? <CalculatorIcon className="size-4 shrink-0" /> : <ArrowUpRightIcon className="size-4 shrink-0" />}
    <span className="min-w-0 flex-1">
      <span className={answer ? 'block break-words text-xl font-medium tabular-nums' : 'block truncate text-sm'}>
        {answer ? item.detail : item.label}
      </span>
      {!answer && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
    </span>
    <span className="shrink-0 text-xs text-muted-foreground">{actionName(item)}</span>
  </>;
}

export function SearchSuggestionList({ input }: { readonly input: SearchFormProps }) {
  return <div className="absolute top-[calc(100%+0.5rem)] left-0 w-full overflow-hidden rounded-2xl border border-border/60 bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-xl">
    <div id="search-suggestions" role="listbox" aria-label="搜索结果" className="max-h-72 overflow-y-auto p-1.5">
      {input.suggestions.map((item, index) => <div key={item.id}>
        {(index === 0 || groupName(input.suggestions[index - 1]!) !== groupName(item)) &&
          <div role="presentation" className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{groupName(item)}</div>}
        <button id={`search-option-${item.id}`} type="button" role="option" aria-selected={index === input.activeIndex}
          onMouseDown={(event) => event.preventDefault()} onClick={() => input.execute(item)}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none aria-selected:bg-accent aria-selected:text-accent-foreground">
          <ResultContent item={item} />
        </button>
      </div>)}
    </div>
    <p className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
      <kbd>↑</kbd><kbd>↓</kbd><span>选择</span><kbd>Enter</kbd>
      <span>{actionName(input.suggestions[input.activeIndex])}</span><kbd>Esc</kbd><span>关闭</span>
    </p>
  </div>;
}
