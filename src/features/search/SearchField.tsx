import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { useBookmarks } from '@/app/bookmark-context';
import { useData } from '@/app/data-context';
import { bookmarkSearchBridge, type BookmarkSearchBridge } from '@/features/search/bookmark-search-adapter';
import { buildSearchResults } from '@/features/search/build-search-results';
import { executeSearchSuggestion, type ExecutionPorts } from '@/features/search/execute-search-suggestion';
import { SearchForm, type SearchFormProps } from '@/features/search/SearchForm';
import { useLocalSearchIndex } from '@/features/search/use-local-search-index';
import { useSearchDismissal } from '@/features/search/use-search-dismissal';
import { writeClipboardText } from '@/platform/clipboard';
import { openUrl } from '@/platform/navigation';
import { notifyError, notifySuccess } from '@/lib/notify';

export interface SearchFieldProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly openFolder: (folderId: string) => void;
  /**
   * 可选覆盖：仅供测试或独立装配显式注入。生产默认从 `BookmarkContext` 读取；
   * 绝不回退到示例数据或伪造书签。
   */
  readonly bookmarkSearch?: BookmarkSearchBridge;
}

function sampleInput(query: string) {
  return { query, context: { now: new Date(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
}

function useInputState(inputRef: SearchFieldProps['inputRef']) {
  const [input, setInput] = useState(() => sampleInput(''));
  const [focused, setFocused] = useState(false);
  const [started, setStarted] = useState(false);
  const [selectedId, select] = useState<string | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const suppressSubmit = useRef(false);
  const dismiss = useCallback(() => setFocused(false), []);
  const focus = useCallback(() => { setFocused(true); setStarted(true); }, []);
  const change = useCallback((query: string) => {
    setInput(sampleInput(query));
    select(null);
    setFocused(true);
  }, []);
  const fill = useCallback((query: string) => {
    change(query);
    inputRef.current?.focus();
  }, [change, inputRef]);
  useSearchDismissal({ root, inputRef, dismiss });
  return { ...input, focused, started, selectedId, root, composing, suppressSubmit, select, dismiss, focus, change, fill };
}

function bookmarkPorts(bridge: BookmarkSearchBridge | null): Pick<ExecutionPorts, 'openBookmark' | 'openBookmarkFolder'> {
  if (!bridge) return {};
  return { openBookmark: bridge.openBookmark, openBookmarkFolder: bridge.openBookmarkFolder };
}

/**
 * 搜索控制器。
 *
 * 书签桥每次渲染都由当前上下文快照同步派生：关闭功能、撤销权限或无匹配状态时立即变成
 * `null`，不需要等待异步索引重建；`useLocalSearchIndex` 内部也会在书签输入变化时重算，
 * 但即使重算尚未完成，旧的「不可读」结果也会因桥为空而被整体丢弃。
 */
function useSearchController({ inputRef, openFolder, bookmarkSearch }: SearchFieldProps): SearchFormProps {
  const { settings, folders, shortcuts, listAllShortcuts, setDefaultEngine } = useData();
  const bookmarkContext = useBookmarks();
  const state = useInputState(inputRef);
  const customization = settings.search.customization;
  const bridge = useMemo(() => bookmarkSearch ?? bookmarkSearchBridge(bookmarkContext),
    [bookmarkSearch, bookmarkContext]);
  const bookmarksEnabled = bridge?.showInSearch === true && bridge.projection !== null;
  const bookmarkIndexInput = useMemo(() => (bridge && bookmarksEnabled
    ? { showInSearch: true, projection: bridge.projection } : undefined),
  [bridge, bookmarksEnabled]);
  const index = useLocalSearchIndex({ enabled: state.started && (customization.showSites || customization.showFolders || bookmarksEnabled),
    folders, shortcuts, listAllShortcuts, bookmarks: bookmarkIndexInput });
  const results = useMemo(() => buildSearchResults({ query: state.query, settings: settings.search,
    context: state.context, index: index.items, indexStatus: index.status, indexError: index.error,
    bookmarks: { showInSearch: bookmarksEnabled, index: index.bookmarkItems } }),
  [state.query, state.context, settings.search, index, bookmarksEnabled]);
  const preferred = results.items.findIndex(({ id }) => id === (state.selectedId ?? results.defaultId));
  const activeIndex = preferred < 0 ? 0 : preferred;
  const execute = useCallback((item = results.items[activeIndex]) => {
    if (!item) return;
    void executeSearchSuggestion({ item, targets: { search: settings.search.openTarget, shortcut: settings.shortcuts.openTarget },
      ports: { copy: writeClipboardText, open: openUrl, openFolder, fill: state.fill,
        dismiss: () => { state.dismiss(); inputRef.current?.blur(); },
        copied: () => notifySuccess('已复制到剪贴板'), ...bookmarkPorts(bridge) } }).catch(notifyError);
  }, [results.items, activeIndex, settings.search.openTarget, settings.shortcuts.openTarget, openFolder, state.fill, state.dismiss,
    inputRef, bridge]);
  return { inputRef, root: state.root, query: state.query, onChange: state.change, onFocus: state.focus,
    onDismiss: state.dismiss, select: state.select, composing: state.composing, suppressSubmit: state.suppressSubmit,
    showing: state.focused && state.query.trim().length > 0 && results.items.length > 0,
    suggestions: results.items, activeIndex, execute, customization, engineId: settings.search.defaultEngineId,
    engines: settings.search.customEngines, engineOverrides: customization.engineOverrides, setDefaultEngine };
}

export function SearchField(props: SearchFieldProps) {
  return <SearchForm {...useSearchController(props)} />;
}
