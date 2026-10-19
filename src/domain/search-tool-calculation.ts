import { calculateSearchExpression } from '@/domain/search-calculator';
import { convertSearchUnit } from '@/domain/search-converters';
import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';
import { createToolAction, isEnabled, toolResults } from '@/domain/search-tool-utils';

const GROUP: SearchToolGroup = 'calculation';

function copyResult(value: string, label: string, explicit: boolean): SearchToolResults {
  const action = createToolAction({ toolId: 'calculation', group: GROUP, actionId: 'copy', kind: 'copy',
    label, value, detail: value });
  return toolResults([action], explicit, action.id);
}

function errorResult(detail: string, explicit: boolean): SearchToolResults {
  const action = createToolAction({ toolId: 'calculation', group: GROUP, actionId: 'error', kind: 'error',
    label: '无法计算', value: '', detail });
  return toolResults([action], explicit, action.id);
}

function expressionResult(query: string, explicit: boolean): SearchToolResults | null {
  const result = calculateSearchExpression(query);
  if (!result.matched) return null;
  if ('error' in result) return errorResult(result.error, explicit);
  return copyResult(result.value, '复制计算结果', explicit);
}

function unitResult(query: string, explicit: boolean): SearchToolResults | null {
  const result = convertSearchUnit(query);
  if (!result.matched) return null;
  if ('error' in result) return errorResult(result.error, explicit);
  return copyResult(result.value, result.label, explicit);
}

export function parseCalculationTool(
  query: string,
  context: SearchToolContext,
  enabled: readonly SearchToolGroup[],
): SearchToolResults | null {
  void context;
  const explicit = query.trimStart().startsWith('=');
  const result = expressionResult(query, explicit) ?? unitResult(query, explicit);
  if (!result) return null;
  if (!isEnabled(GROUP, enabled)) return explicit ? errorResult('计算工具已关闭', true) : null;
  return result;
}
