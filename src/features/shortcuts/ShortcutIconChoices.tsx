import { ALargeSmallIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BuiltInIconPicker } from '@/features/shortcuts/BuiltInIconPicker';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

export function ShortcutIconChoices({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <div className="flex items-center gap-1" aria-label="图标样式">
      <Button type="button" variant="ghost" size="icon" aria-label="使用名称首字母" title="名称首字母"
          aria-pressed={!draft.image && draft.icon.kind === 'letter'} disabled={draft.saving || draft.imageBusy}
          onClick={draft.resetIcon}>
        <ALargeSmallIcon aria-hidden="true" />
      </Button>
      <BuiltInIconPicker draft={draft} />
    </div>
  );
}
