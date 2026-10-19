import type { OpenTarget } from '@/domain/settings';
import type { SearchSuggestion } from '@/features/search/search-model';

interface ExecutionPorts {
  readonly copy: (value: string) => Promise<void>;
  readonly open: (url: string, target: OpenTarget) => void;
  readonly openFolder: (id: string) => void;
  readonly fill: (query: string) => void;
  readonly dismiss: () => void;
  readonly copied: () => void;
}

export async function executeSearchSuggestion(input: { readonly item: SearchSuggestion;
  readonly targets: { readonly search: OpenTarget; readonly shortcut: OpenTarget }; readonly ports: ExecutionPorts }): Promise<void> {
  const { item, targets, ports } = input;
  if (item.kind === 'error') throw new Error(item.detail);
  if (item.kind === 'status') return;
  if (item.kind === 'fill') { ports.fill(item.value); return; }
  if (item.kind === 'copy') {
    await ports.copy(item.value);
    ports.copied();
    return;
  }
  ports.dismiss();
  if (item.kind === 'folder') { ports.openFolder(item.value); return; }
  ports.open(item.value, item.section === 'site' ? targets.shortcut : targets.search);
}
