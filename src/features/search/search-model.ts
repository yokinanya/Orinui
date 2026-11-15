import type { SearchToolAction } from '@/domain/search-tool-types';

/**
 * 搜索建议类别。
 *
 * `bookmark` 与 `bookmark-folder` 是浏览器书签结果，与自有 `site` / `folder` 分开：
 * 它们的激活走平台书签端口，不写入 Orinui 数据。
 */
export type SearchSuggestionKind = SearchToolAction['kind'] | 'folder' | 'search' | 'status' | 'bookmark' | 'bookmark-folder';
export type SearchSuggestionSection = 'tool' | 'search' | 'site' | 'folder' | 'navigation' | 'status';

export interface SearchSuggestion {
  readonly id: string;
  readonly kind: SearchSuggestionKind;
  readonly section: SearchSuggestionSection;
  readonly label: string;
  readonly detail: string;
  readonly value: string;
  readonly swatch?: string;
  readonly contrast?: { readonly foreground: string; readonly background: string };
  /** 浏览器书签节点在当前投影内的标识路径；不落库、不跨投影复用。 */
  readonly bookmarkPath?: readonly string[];
  /** 浏览器书签节点 ID；激活时按它定位当前快照中的真实节点。 */
  readonly bookmarkNodeId?: string;
  /** 无地址或结构不可用的浏览器书签：仍可搜索，激活时显示原因而不是执行。 */
  readonly unavailable?: boolean;
  readonly activationError?: string;
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
  if (item.unavailable) return '无法打开';
  return item.kind === 'status' ? '等待' : '打开';
}
