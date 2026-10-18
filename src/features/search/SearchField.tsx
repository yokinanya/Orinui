import { SearchEnginePicker } from '@/features/search/SearchEnginePicker';
import { SearchSuggestionList } from '@/features/search/SearchSuggestionList';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useData } from '@/app/data-context';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { buildSearchUrl, resolveEngine } from '@/domain/search-engines';
import type { AppSettings, OpenTarget } from '@/domain/settings';
import type { Folder } from '@/domain/folder';
import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';
import { parseSearchTool, type SearchToolAction } from '@/domain/search-tools';
import { writeClipboardText } from '@/platform/clipboard';
import { openUrl } from '@/platform/navigation';
import { notifyError, notifySuccess } from '@/lib/notify';

const IME_PROCESSING_KEY = 229;
export type Suggestion = { readonly id: string; readonly kind: 'open' | 'copy' | 'error' | 'folder' | 'search';
  readonly label: string; readonly detail: string; readonly value?: string };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function matchScore(value: string, query: string): number | null {
  const normalized = value.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  if (normalized === needle) return 0;
  if (normalized.startsWith(needle)) return 1;
  return normalized.includes(needle) ? 2 : null;
}

function toolSuggestion(action: SearchToolAction): Suggestion {
  return { id: `tool:${action.kind}`, kind: action.kind, label: action.label, detail: action.detail, value: action.value };
}

function localSuggestions(input: {
  readonly query: string;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly openFolder: (folderId: string) => void;
}): Suggestion[] {
  const folderById = new Map(input.folders.map((folder) => [folder.id, folder]));
  const matches = input.shortcuts.flatMap((shortcut) => {
    const folder = shortcut.folderId === null ? null : folderById.get(shortcut.folderId);
    if (shortcut.folderId !== null && !folder) return [];
    const scores = [matchScore(shortcutDisplayName(shortcut), input.query), matchScore(shortcut.url, input.query),
      folder ? matchScore(folder.name, input.query) : null]
      .filter((score): score is number => score !== null);
    return scores.length === 0 ? [] : [{ shortcut, folder, score: Math.min(...scores) }];
  }).toSorted((left, right) => left.score - right.score || left.shortcut.order - right.shortcut.order);
  const siteResults: Suggestion[] = matches.map(({ shortcut, folder }) => ({ id: `site:${shortcut.id}`, kind: 'open',
    label: shortcutDisplayName(shortcut), detail: `${folder?.name ?? '主页'} · ${shortcut.url}`, value: shortcut.url }));
  const folderResults: Suggestion[] = input.folders.filter(({ name }) => matchScore(name, input.query) !== null)
    .map((folder) => ({ id: `folder:${folder.id}`, kind: 'folder' as const, label: `打开文件夹「${folder.name}」`,
      detail: '本地文件夹', value: folder.id }));
  return [...siteResults, ...folderResults];
}

function searchSuggestion(engineName: string, query: string): Suggestion {
  return { id: 'search', kind: 'search', label: `用 ${engineName} 搜索`, detail: query };
}

function defaultIndex(items: readonly Suggestion[]): number {
  const tool = items.findIndex(({ id }) => id.startsWith('tool:'));
  return tool >= 0 ? tool : Math.max(0, items.findIndex(({ kind }) => kind === 'search'));
}

function useSearchIndex(listAllShortcuts: () => Promise<Shortcut[]>, shortcuts: readonly Shortcut[]) {
  const [items, setItems] = useState<Shortcut[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listAllShortcuts().then((all) => { if (!cancelled) setItems(all); }).catch(notifyError);
    return () => { cancelled = true; };
  }, [listAllShortcuts, shortcuts]);
  return items;
}

function executeSuggestion(input: { readonly item: Suggestion; readonly query: string; readonly engineId: string;
  readonly customEngines: AppSettings['search']['customEngines']; readonly searchTarget: OpenTarget;
  readonly shortcutTarget: OpenTarget; readonly openFolder: (folderId: string) => void }): void {
  const { item, query, engineId, customEngines, searchTarget, shortcutTarget, openFolder } = input;
  if (item.kind === 'error') { notifyError(new Error(item.detail)); return; }
  if (item.kind === 'folder') { if (item.value) openFolder(item.value); return; }
  if (item.kind === 'copy') {
    void writeClipboardText(item.value ?? '').then(() => notifySuccess('已复制到剪贴板')).catch(notifyError);
    return;
  }
  if (item.kind === 'open') {
    if (item.value) openUrl(item.value, item.id.startsWith('tool:') ? searchTarget : shortcutTarget);
    return;
  }
  const engine = resolveEngine(engineId, customEngines);
  if (!engine) { notifyError(new Error('默认搜索引擎不存在')); return; }
  openUrl(buildSearchUrl(engine, query), searchTarget);
}

export interface SearchFieldProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** 选中文件夹建议时打开对应文件夹弹层。 */
  readonly openFolder: (folderId: string) => void;
}

export function SearchField({ inputRef, openFolder }: SearchFieldProps) {
  const { settings, folders, shortcuts, listAllShortcuts, setDefaultEngine } = useData();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const allShortcuts = useSearchIndex(listAllShortcuts, shortcuts);
  const engine = resolveEngine(settings.search.defaultEngineId, settings.search.customEngines);
  const queryText = query.trim();
  const tool = queryText ? parseSearchTool(queryText) : null;
  const suggestions = useSearchSuggestions({ queryText, tool, engineName: engine?.name, folders, shortcuts: allShortcuts, openFolder });
  const activeIndex = selectedIndex ?? defaultIndex(suggestions);
  const showing = focused && queryText.length > 0 && suggestions.length > 0;
  useSearchDismissal({ root, inputRef, setFocused });
  const execute = useSuggestionExecutor({ activeIndex, queryText, settings, openFolder, suggestions, inputRef, setFocused });
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => handleSearchKey({
    event, query, showing, activeIndex, count: suggestions.length, setQuery, setSelectedIndex, setFocused, execute,
  });
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (showing) execute();
    else if (queryText && engine) openUrl(buildSearchUrl(engine, queryText), settings.search.openTarget);
  };

  return <SearchForm root={root} inputRef={inputRef} query={query} onChange={(value) => {
    setQuery(value); setSelectedIndex(null);
  }} onFocus={() => setFocused(true)} onKeyDown={handleKeyDown} onSubmit={submit} showing={showing}
    suggestions={suggestions} activeIndex={activeIndex} execute={execute} engineId={settings.search.defaultEngineId}
    engines={settings.search.customEngines} setDefaultEngine={setDefaultEngine} />;
}

interface SearchKeyInput {
  readonly event: ReactKeyboardEvent<HTMLInputElement>;
  readonly query: string;
  readonly showing: boolean;
  readonly activeIndex: number;
  readonly count: number;
  readonly setQuery: (value: string) => void;
  readonly setSelectedIndex: (index: number) => void;
  readonly setFocused: (focused: boolean) => void;
  readonly execute: () => void;
}

function moveSearchSelection(input: SearchKeyInput): boolean {
  const { event, showing, activeIndex, count, setSelectedIndex } = input;
  if (!showing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return false;
  event.preventDefault();
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  setSelectedIndex((activeIndex + direction + count) % count);
  return true;
}

/**
 * Escape 分两级：先收起建议，再清空已输入的关键词。
 * 已清空或没有内容时再按才交还给浏览器（例如退出全屏）。
 */
function handleSearchEscape(input: SearchKeyInput): boolean {
  const { event, query, showing, setQuery, setSelectedIndex, setFocused } = input;
  if (event.key !== 'Escape') return false;
  if (showing) {
    event.preventDefault();
    setFocused(false);
    return true;
  }
  if (query.trim() === '') return false;
  event.preventDefault();
  setQuery('');
  setSelectedIndex(0);
  return true;
}

function handleSearchKey(input: SearchKeyInput): void {
  const { event, showing, execute } = input;
  if (event.nativeEvent.isComposing || event.keyCode === IME_PROCESSING_KEY) return;
  if (moveSearchSelection(input)) return;
  if (handleSearchEscape(input)) return;
  if (event.key === 'Enter' && showing) { event.preventDefault(); execute(); }
}

function useSearchSuggestions(input: { readonly queryText: string; readonly tool: SearchToolAction | null;
  readonly engineName: string | undefined; readonly folders: readonly Folder[]; readonly shortcuts: readonly Shortcut[];
  readonly openFolder: (folderId: string) => void }) {
  return useMemo(() => {
    if (!input.queryText || !input.engineName) return [];
    const toolItems = input.tool ? [toolSuggestion(input.tool)] : [];
    return [...toolItems, searchSuggestion(input.engineName, input.queryText),
      ...localSuggestions({ query: input.queryText, folders: input.folders,
        shortcuts: input.shortcuts, openFolder: input.openFolder })];
  }, [input.queryText, input.tool?.kind, input.tool?.label, input.tool?.value, input.tool?.detail,
    input.engineName, input.folders, input.shortcuts]);
}

function useSearchDismissal(input: { readonly root: RefObject<HTMLFormElement | null>;
  readonly inputRef: RefObject<HTMLInputElement | null>; readonly setFocused: (focused: boolean) => void }) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !input.root.current?.contains(event.target)) input.setFocused(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [input.root, input.setFocused]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      event.preventDefault(); input.inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [input.inputRef]);
}

function useSuggestionExecutor(input: { readonly activeIndex: number; readonly queryText: string;
  readonly settings: AppSettings; readonly openFolder: (folderId: string) => void;
  readonly suggestions: readonly Suggestion[]; readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly setFocused: (focused: boolean) => void }) {
  return useCallback((item = input.suggestions[input.activeIndex]) => {
    if (!item) return;
    try {
      executeSuggestion({ item, query: input.queryText, engineId: input.settings.search.defaultEngineId,
        customEngines: input.settings.search.customEngines, searchTarget: input.settings.search.openTarget,
        shortcutTarget: input.settings.shortcuts.openTarget, openFolder: input.openFolder });
      if (item.kind !== 'error') { input.setFocused(false); input.inputRef.current?.blur(); }
    } catch (error) { notifyError(error); }
  }, [input.activeIndex, input.queryText, input.settings, input.openFolder, input.suggestions, input.inputRef, input.setFocused]);
}

export interface SearchFormProps {
  readonly root: RefObject<HTMLFormElement | null>;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly onChange: (value: string) => void;
  readonly onFocus: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly showing: boolean;
  readonly suggestions: readonly Suggestion[];
  readonly activeIndex: number;
  readonly execute: (item?: Suggestion) => void;
  readonly engineId: string;
  readonly engines: AppSettings['search']['customEngines'];
  readonly setDefaultEngine: (id: string) => Promise<void>;
}

function SearchForm(input: SearchFormProps) {
  return <form ref={input.root} role="search" className="relative z-40 w-full" onSubmit={input.onSubmit}>
    <InputGroup className="home-readable-surface h-12 rounded-2xl border border-primary/30 shadow-sm shadow-black/[0.05] backdrop-blur-md"
      style={{ backgroundColor: 'var(--home-readable-search-surface, var(--glass))' }}>
      <InputGroupAddon className="pl-2"><SearchEnginePicker engineId={input.engineId} engines={input.engines} setDefaultEngine={input.setDefaultEngine} /></InputGroupAddon>
      <InputGroupInput ref={input.inputRef} value={input.query} onFocus={input.onFocus} onKeyDown={input.onKeyDown}
        onChange={(event) => input.onChange(event.target.value)} placeholder="搜索、查找网站或计算"
        aria-label="搜索" aria-autocomplete="list" aria-expanded={input.showing}
        aria-controls={input.showing ? 'search-suggestions' : undefined}
        aria-activedescendant={input.showing ? `search-option-${input.suggestions[input.activeIndex]?.id}` : undefined}
        className="home-readable-ink h-12 pr-1 text-base text-glass-foreground placeholder:text-glass-foreground-muted md:text-base" />
    </InputGroup>
    {input.showing && <SearchSuggestionList input={input} />}
  </form>;
}
