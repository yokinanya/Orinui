import { calculateSearchExpression } from '@/domain/search-calculator';
import { convertSearchDateTime, convertSearchUnit } from '@/domain/search-converters';

export interface SearchToolAction {
  readonly kind: 'open' | 'copy' | 'error';
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

function githubAction(query: string): SearchToolAction | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(query.trim());
  if (!match) return null;
  const url = `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`;
  return { kind: 'open', label: '打开 GitHub Issue 或 PR', value: url, detail: `${match[1]}/${match[2]} #${match[3]}` };
}

function fromConversion(result: { readonly matched: boolean; readonly value?: string; readonly label?: string; readonly error?: string }): SearchToolAction | null {
  if (!result.matched) return null;
  if (result.error) return { kind: 'error', label: '无法换算', value: '', detail: result.error };
  const value = result.value ?? '';
  return { kind: 'copy', label: result.label ?? '复制结果', value, detail: value };
}

function calculatorAction(query: string): SearchToolAction | null {
  const result = calculateSearchExpression(query);
  if (!result.matched) return null;
  if (result.error) return { kind: 'error', label: '算式错误', value: '', detail: result.error };
  return { kind: 'copy', label: '复制计算结果', value: result.value ?? '', detail: result.value ?? '' };
}

export function parseSearchTool(query: string): SearchToolAction | null {
  return githubAction(query) ?? fromConversion(convertSearchUnit(query))
    ?? fromConversion(convertSearchDateTime(query)) ?? calculatorAction(query);
}
