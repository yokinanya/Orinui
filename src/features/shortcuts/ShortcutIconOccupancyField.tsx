import { Field, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { SHORTCUT_ICON_OCCUPANCY } from '@/domain/shortcut-icon';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

export function ShortcutIconOccupancyField({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel id="shortcut-icon-occupancy-label">图标占比</FieldLabel>
        <output aria-label="当前图标占比" className="text-sm text-muted-foreground tabular-nums">{draft.iconOccupancy}%</output>
      </div>
      <Slider aria-labelledby="shortcut-icon-occupancy-label" value={[draft.iconOccupancy]}
        min={SHORTCUT_ICON_OCCUPANCY.minimum} max={SHORTCUT_ICON_OCCUPANCY.maximum} step={SHORTCUT_ICON_OCCUPANCY.step}
        disabled={draft.saving || draft.imageBusy}
        onValueChange={(value) => draft.setIconOccupancy(Array.isArray(value) ? value[0]! : value)} />
    </Field>
  );
}
