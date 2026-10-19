import type { SearchToolAction } from '@/domain/search-tool-types';

export interface SearchSuggestion {
  readonly id: string;
  readonly kind: SearchToolAction['kind'] | 'folder' | 'search' | 'status';
  readonly section: 'tool' | 'search' | 'site' | 'folder' | 'navigation' | 'status';
  readonly label: string;
  readonly detail: string;
  readonly value: string;
  readonly swatch?: string;
  readonly contrast?: { readonly foreground: string; readonly background: string };
}

export interface SearchResults {
  readonly items: readonly SearchSuggestion[];
  readonly defaultId: string;
}

export function searchActionName(item: SearchSuggestion | undefined): string {
  if (!item) return '选择';
  if (item.kind === 'copy') return '复制';
  if (item.kind === 'fill') return '填入示例';
  if (item.kind === 'search') return '搜索';
  if (item.kind === 'error') return '查看错误';
  return item.kind === 'status' ? '等待' : '打开';
}
