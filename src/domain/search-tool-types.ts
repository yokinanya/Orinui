import type { SearchToolGroup } from '@/domain/search-customization';

export interface SearchToolContext {
  readonly now: Date;
  readonly timeZone: string;
}

export interface SearchToolAction {
  readonly id: string;
  readonly toolId: string;
  readonly group: SearchToolGroup;
  readonly kind: 'open' | 'copy' | 'error' | 'fill';
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly swatch?: string;
  readonly contrast?: { readonly foreground: string; readonly background: string };
}

export interface SearchToolResults {
  readonly actions: readonly SearchToolAction[];
  readonly explicit: boolean;
  readonly preferredId?: string;
}
