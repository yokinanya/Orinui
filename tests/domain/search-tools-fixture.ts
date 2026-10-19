import { getSearchToolResults } from '@/domain/search-tools';
import type { SearchToolContext, SearchToolGroup } from '@/domain/search-tools';

const ALL_GROUPS: readonly SearchToolGroup[] = ['calculation', 'datetime', 'color', 'github'];
const CONTEXT: SearchToolContext = { now: new Date('2026-10-19T04:05:06.000Z'), timeZone: 'Asia/Hong_Kong' };

export function search(query: string, enabledGroups = ALL_GROUPS) {
  return getSearchToolResults({ query, context: CONTEXT, enabledGroups });
}
