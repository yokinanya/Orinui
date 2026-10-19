import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';
import { parseCalculationTool } from '@/domain/search-tool-calculation';
import { parseColorTool } from '@/domain/search-tool-color';
import { parseDateTimeTool } from '@/domain/search-tool-datetime';
import { parseGitHubTool } from '@/domain/search-tool-github';
import { createToolAction, toolResults } from '@/domain/search-tool-utils';

export type { SearchToolAction, SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
export type { SearchToolGroup } from '@/domain/search-customization';

interface SearchToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly group: SearchToolGroup;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly parse: (query: string, context: SearchToolContext, enabled: readonly SearchToolGroup[]) => SearchToolResults | null;
}

export const SEARCH_TOOLS: readonly SearchToolDefinition[] = [
  { id: 'calculation', label: '计算/单位换算', group: 'calculation', aliases: ['=', '计算', 'calculate', '单位', 'unit'],
    examples: ['=2*(3+4)', '25 C to F'], parse: parseCalculationTool },
  { id: 'datetime', label: '日期与时间', group: 'datetime', aliases: ['ts', 'unix', 'unixms', 'date', 'datediff', '日期', '日期差', '时间', '时间戳'],
    examples: ['ts now', 'unix:0', '日期 2026-10-01 + 2周', '日期差 2026-10-01 2026-10-19'], parse: parseDateTimeTool },
  { id: 'color', label: '颜色与对比度', group: 'color', aliases: ['color', 'contrast', '颜色', '对比度'],
    examples: ['#ff7043', '颜色 hsl(210 50% 40%)', '对比度 #111 #fff'], parse: parseColorTool },
  { id: 'github', label: 'GitHub', group: 'github', aliases: ['gh'],
    examples: ['gh owner/repo', 'gh owner/repo#123', 'gh code owner/repo auth token', 'gh clone owner/repo'],
    parse: parseGitHubTool },
];

function matchingTools(query: string): readonly SearchToolDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  return SEARCH_TOOLS.filter(({ aliases }) => aliases.some((alias) => alias.toLocaleLowerCase() === normalized));
}

function discoveryResults(enabledGroups: readonly SearchToolGroup[], query: string): SearchToolResults {
  const allTools = query.trim() === '?';
  const tools = allTools ? SEARCH_TOOLS : matchingTools(query);
  const actions = tools.filter(({ group }) => enabledGroups.includes(group)).flatMap(({ group, id, label, examples }) =>
    examples.map((example, index) => createToolAction({ toolId: id, group, actionId: `discover-${index + 1}`,
      kind: 'fill', label, value: example, detail: `示例：${example}` })));
  const explicit = allTools || query.trim() === '=' || (/^[a-z]+$/i.test(query.trim()) && tools.length > 0);
  return toolResults(actions, explicit, explicit ? actions[0]?.id : undefined);
}

export function getSearchToolResults(input: {
  readonly query: string;
  readonly context: SearchToolContext;
  readonly enabledGroups: readonly SearchToolGroup[];
}): SearchToolResults {
  if (input.query.trim() === '?' || matchingTools(input.query).some(({ group }) => group !== 'github')) {
    return discoveryResults(input.enabledGroups, input.query);
  }
  for (const tool of SEARCH_TOOLS) {
    const result = tool.parse(input.query, input.context, input.enabledGroups);
    if (result) return result;
  }
  return toolResults([], false);
}
