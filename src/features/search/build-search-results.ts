import { searchLocalIndex, type LocalSearchItem } from '@/domain/local-search';
import { resolveSearchQuery } from '@/domain/search-query';
import { getSearchToolResults } from '@/domain/search-tools';
import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { AppSettings } from '@/domain/settings';
import type { SearchResults, SearchSuggestion } from '@/features/search/search-model';

interface ResultInput {
  readonly query: string;
  readonly settings: AppSettings['search'];
  readonly context: SearchToolContext;
  readonly index: readonly LocalSearchItem[];
  readonly indexStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly indexError: string | null;
}

function localResults(input: ResultInput): readonly SearchSuggestion[] {
  if (!input.settings.customization.showSites && !input.settings.customization.showFolders) return [];
  if (input.indexStatus !== 'ready') return [{ id: 'local:status', section: 'status', value: '',
    kind: input.indexStatus === 'error' ? 'error' : 'status', label: '本地检索',
    detail: input.indexError ?? '正在建立本地搜索索引…' }];
  return searchLocalIndex({ index: input.index, query: input.query, sources: input.settings.customization })
    .map((item) => ({ ...item, id: `${item.kind}:${item.id}`, section: item.kind,
      kind: item.kind === 'site' ? 'open' : 'folder' }));
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
