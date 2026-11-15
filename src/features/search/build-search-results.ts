import { searchLocalIndex, type LocalSearchItem } from '@/domain/local-search';
import { resolveSearchQuery } from '@/domain/search-query';
import { getSearchToolResults } from '@/domain/search-tools';
import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { AppSettings } from '@/domain/settings';
import type { SearchResults, SearchSuggestion, SearchSuggestionKind } from '@/features/search/search-model';

/** 调用方已按投影身份构建好的书签索引；搜索不自行读浏览器 API、权限或缓存。 */
export interface BookmarkSearchInput {
  /** settings.bookmarks.showInSearch；关闭时不显示书签结果。 */
  readonly showInSearch: boolean;
  readonly index: readonly LocalSearchItem[];
}

interface ResultInput {
  readonly query: string;
  readonly settings: AppSettings['search'];
  readonly context: SearchToolContext;
  readonly index: readonly LocalSearchItem[];
  readonly indexStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly indexError: string | null;
  /** 调用方已完成状态判定与隐藏投影的书签索引，以及搜索开关。 */
  readonly bookmarks?: BookmarkSearchInput;
}

function enabledLocalSources(settings: AppSettings['search'], bookmarks: BookmarkSearchInput | undefined) {
  return { showSites: settings.customization.showSites, showFolders: settings.customization.showFolders,
    showBookmarks: bookmarks?.showInSearch === true };
}

function suggestionKind(kind: LocalSearchItem['kind']): SearchSuggestionKind {
  if (kind === 'site') return 'open';
  if (kind === 'folder') return 'folder';
  return kind;
}

/** 不可激活条目的统一说明：标题仍可搜索，激活时明确失败而不是执行。 */
export const UNAVAILABLE_BOOKMARK_ERROR = '此书签没有可用地址，无法打开';
export const BOOKMARK_PORT_MISSING_ERROR = '浏览器书签打开端口未接入';

function localToSuggestion(item: LocalSearchItem): SearchSuggestion {
  return { ...item, id: `${item.kind}:${item.id}`,
    section: item.kind === 'site' || item.kind === 'bookmark' ? 'site' : 'folder',
    kind: suggestionKind(item.kind),
    ...(item.unavailable === true ? { activationError: UNAVAILABLE_BOOKMARK_ERROR } : {}) };
}

function localResults(input: ResultInput): readonly SearchSuggestion[] {
  const sources = enabledLocalSources(input.settings, input.bookmarks);
  const anySource = sources.showSites || sources.showFolders || sources.showBookmarks;
  if (!anySource) return [];
  const ownIndex = input.indexStatus === 'ready' ? input.index : [];
  const index = input.bookmarks?.showInSearch === true ? [...ownIndex, ...input.bookmarks.index] : ownIndex;
  // 自有索引加载状态只描述自有来源；书签已由调用方给出确定的投影状态。
  const ownSourceEnabled = sources.showSites || sources.showFolders;
  if (ownSourceEnabled && input.indexStatus !== 'ready') {
    return [{ id: 'local:status', section: 'status', value: '',
      kind: input.indexStatus === 'error' ? 'error' : 'status', label: '本地检索',
      detail: input.indexError ?? '正在建立本地搜索索引…' }];
  }
  return searchLocalIndex({ index, query: input.query, sources }).map(localToSuggestion);
}

function explicitToolResults(tools: SearchToolResults, actions: readonly SearchSuggestion[]): SearchResults {
  if (!actions.length) return { items: [{ id: 'tool:disabled', kind: 'status', section: 'tool',
    label: '此快捷工具未启用', detail: '可在搜索设置的结果内容中启用', value: '' }], defaultId: 'tool:disabled' };
  return { items: actions, defaultId: tools.preferredId ?? actions[0]!.id };
}

function queryResults(input: ResultInput): SearchResults {
  const route = resolveSearchQuery(input);
  if (route.error) return { items: [{ id: 'query:error', kind: 'error', section: 'navigation',
    label: '无法处理输入', detail: route.error, value: '' }], defaultId: 'query:error' };
  const search: SearchSuggestion = { id: 'search', kind: 'search', section: 'search',
    label: `用 ${route.engineName} 搜索`, detail: route.query, value: route.searchUrl };
  if (route.keyword) return { items: [search], defaultId: search.id };
  const tools = getSearchToolResults({ query: input.query, context: input.context,
    enabledGroups: input.settings.customization.enabledTools });
  const actions: SearchSuggestion[] = tools.actions.map((action) => ({ ...action, section: 'tool' }));
  if (tools.explicit) return explicitToolResults(tools, actions);
  const address: SearchSuggestion[] = route.navigationUrl ? [{ id: 'navigation', kind: 'open', section: 'navigation',
    label: '打开网址', detail: route.navigationUrl, value: route.navigationUrl }] : [];
  return { items: [...actions, ...address, search, ...localResults(input)],
    defaultId: tools.preferredId ?? address[0]?.id ?? search.id };
}

export function buildSearchResults(input: ResultInput): SearchResults {
  if (!input.query.trim()) return { items: [], defaultId: '' };
  try { return queryResults({ ...input, query: input.query.trim() }); }
  catch (cause) {
    return { items: [{ id: 'query:error', kind: 'error', section: 'navigation', label: '搜索出错', value: '',
      detail: cause instanceof Error ? cause.message : String(cause) }], defaultId: 'query:error' };
  }
}
