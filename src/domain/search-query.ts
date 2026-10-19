import { buildSearchUrl, resolveEngine } from '@/domain/search-engines';
import type { AppSettings } from '@/domain/settings';
import { normalizeShortcutUrl } from '@/domain/url';

export interface SearchQuery {
  readonly query: string;
  readonly engineName: string;
  readonly searchUrl: string;
  readonly keyword: boolean;
  readonly navigationUrl?: string;
  readonly error?: string;
}

const EXPLICIT_ADDRESS = /^[a-z][a-z\d+.-]*:\/\//i;
const DOMAIN_ADDRESS = /^(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+[\p{L}][\p{L}\p{N}-]*(?::\d+)?(?:[/?#][^\s]*)?$/u;
const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#][^\s]*)?$/u;

function addressCandidate(query: string): boolean {
  return EXPLICIT_ADDRESS.test(query) || DOMAIN_ADDRESS.test(query) || IPV4_ADDRESS.test(query);
}

function resolveAddress(query: string): Pick<SearchQuery, 'navigationUrl' | 'error'> {
  if (!addressCandidate(query)) return {};
  try {
    return { navigationUrl: normalizeShortcutUrl(query) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** 关键词只影响当前输入，不写回默认搜索引擎。 */
export function resolveSearchQuery(input: { readonly query: string; readonly settings: AppSettings['search'] }): SearchQuery {
  const text = input.query.trim();
  const [prefix = ''] = text.split(/\s+/u);
  const keywordId = Object.entries(input.settings.customization.engineKeywords)
    .find(([, keyword]) => keyword.toLocaleLowerCase() === prefix.toLocaleLowerCase())?.[0];
  const engine = resolveEngine(keywordId ?? input.settings.defaultEngineId, input.settings.customEngines);
  if (!engine) throw new Error('搜索引擎不存在');
  const query = keywordId ? text.slice(prefix.length).trim() : text;
  const base = { query, engineName: engine.name, searchUrl: buildSearchUrl(engine, query), keyword: keywordId !== undefined };
  if (keywordId) return query ? base : { ...base, error: `请输入要用 ${engine.name} 搜索的内容` };
  return { ...base, ...resolveAddress(query) };
}
