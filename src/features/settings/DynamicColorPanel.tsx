import { useState } from 'react';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NEUTRAL_SEED } from '@/domain/appearance';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { useAppearanceActions } from '@/features/settings/appearance-actions';

function SeedField({ seed, onChange }: { readonly seed: string; readonly onChange: (seed: string) => void }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor="seed-color">种子色</FieldLabel>
        <ColorPicker id="seed-color" label="种子色" value={seed} onChange={onChange} />
      </div>
    </Field>
  );
}

export function DynamicColorPanel() {
  const { appearance, update } = useAppearanceActions();
  const color = appearance.dynamicColor;
  const [seedDraft, setSeedDraft] = useState(color.seed ?? NEUTRAL_SEED);
  const selectSeed = (seed: string) => {
    setSeedDraft(seed);
    update({ dynamicColor: { ...color, mode: 'locked', seed } });
  };
  return (
    <FieldGroup>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="dynamic-color">跟随背景取色</FieldLabel>
          <Switch id="dynamic-color" checked={color.enabled}
            onCheckedChange={(enabled) => update({ dynamicColor: { ...color, enabled } })} />
        </div>
      </Field>
      {color.enabled && <Field>
        <FieldLabel>取色方式</FieldLabel>
        <ToggleGroup value={[color.mode]} onValueChange={(value) => {
          if (value[0] === 'follow') update({ dynamicColor: { ...color, mode: 'follow', seed: null } });
          if (value[0] === 'locked') selectSeed(seedDraft);
        }}>
          <ToggleGroupItem value="follow">跟随背景</ToggleGroupItem>
          <ToggleGroupItem value="locked">手动选色</ToggleGroupItem>
        </ToggleGroup>
      </Field>}
      {color.enabled && color.mode === 'locked' && <SeedField seed={color.seed ?? seedDraft} onChange={selectSeed} />}
    </FieldGroup>
  );
}
