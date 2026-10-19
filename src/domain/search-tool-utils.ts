import type { SearchToolAction, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';

export function createToolAction(input: {
  readonly toolId: string;
  readonly group: SearchToolGroup;
  readonly actionId: string;
  readonly kind: SearchToolAction['kind'];
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly swatch?: string;
  readonly contrast?: SearchToolAction['contrast'];
}): SearchToolAction {
  return { id: `${input.toolId}:${input.actionId}`, toolId: input.toolId, group: input.group,
    kind: input.kind, label: input.label, value: input.value, detail: input.detail,
    ...(input.swatch ? { swatch: input.swatch } : {}), ...(input.contrast ? { contrast: input.contrast } : {}) };
}

export function toolResults(
  actions: readonly SearchToolAction[],
  explicit: boolean,
  preferredId?: string,
): SearchToolResults {
  return { actions, explicit, ...(preferredId ? { preferredId } : {}) };
}

export function isEnabled(group: SearchToolGroup, enabledGroups: readonly SearchToolGroup[]): boolean {
  return enabledGroups.includes(group);
}
