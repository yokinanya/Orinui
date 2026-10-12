import { useState } from 'react';
import { ShapesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BUILT_IN_ICON_IDS } from '@/domain/shortcut';
import { BUILT_IN_ICONS } from '@/features/shortcuts/built-in-icons';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

export function BuiltInIconPicker({ draft }: { readonly draft: ShortcutDraft }) {
  const [open, setOpen] = useState(false);
  const selected = !draft.image && draft.icon.kind === 'built-in' ? draft.icon.iconId : null;
  const TriggerIcon = selected ? BUILT_IN_ICONS[selected].Icon : ShapesIcon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="选择内置图标" title="内置图标"
        render={<Button type="button" variant="ghost" size="icon" disabled={draft.saving || draft.imageBusy} />}>
        <TriggerIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 gap-0 p-3">
        <PopoverTitle className="sr-only">内置图标</PopoverTitle>
        <ToggleGroup aria-label="内置图标" multiple={false} size="lg" className="grid w-full grid-cols-3"
          value={selected ? [selected] : []} onValueChange={(values, details) => {
            const iconId = BUILT_IN_ICON_IDS.find((id) => id === values[0]);
            if (!iconId) { details.cancel(); return; }
            draft.chooseIcon({ kind: 'built-in', iconId });
            setOpen(false);
          }}>
          {BUILT_IN_ICON_IDS.map((id) => {
            const { label, Icon } = BUILT_IN_ICONS[id];
            return (
              <ToggleGroupItem key={id} value={id} aria-label={`使用${label}图标`} title={label}>
                <Icon aria-hidden="true" />
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
