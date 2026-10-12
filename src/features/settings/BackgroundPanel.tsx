import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Background, GradientBackground } from '@/domain/appearance';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { useAppearanceActions } from '@/features/settings/appearance-actions';
import { PhotoBackgroundPanel } from '@/features/settings/PhotoBackgroundPanel';

const DEFAULT_SOLID = { kind: 'solid', color: '#f2ece3' } as const;
const DEFAULT_GRADIENT = { kind: 'gradient', from: '#f4efe6', to: '#c9d6e4', angle: 160 } as const;
const FULL_TURN_DEGREES = 360;
const BACKGROUND_OPTIONS = [{ value: 'default', label: '默认' }, { value: 'solid', label: '纯色' }, { value: 'gradient', label: '渐变' }] as const;

function ColorField(props: { readonly id: string; readonly label: string; readonly value: string; readonly onChange: (color: string) => void }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
        <ColorPicker {...props} />
      </div>
    </Field>
  );
}

function GradientFields({ background, onChange }: { readonly background: GradientBackground; readonly onChange: (background: Background) => void }) {
  return (
    <FieldGroup>
      <ColorField id="gradient-from" label="起始颜色" value={background.from} onChange={(from) => onChange({ ...background, from })} />
      <ColorField id="gradient-to" label="结束颜色" value={background.to} onChange={(to) => onChange({ ...background, to })} />
      <Field>
        <FieldLabel htmlFor="gradient-angle">方向（度）</FieldLabel>
        <Input id="gradient-angle" type="number" min={0} max={FULL_TURN_DEGREES} value={background.angle}
          onChange={(event) => {
            if (event.target.value === '') return;
            onChange({ ...background, angle: event.target.valueAsNumber });
          }} />
      </Field>
    </FieldGroup>
  );
}

export function BackgroundPanel() {
  const { appearance, update } = useAppearanceActions();
  const { background } = appearance;
  const setBackground = (next: Background) => update({ background: next });
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>背景</FieldLabel>
        <ToggleGroup value={[background.kind]} onValueChange={(value) => {
          if (value[0] === 'default') setBackground({ kind: 'default' });
          if (value[0] === 'solid') setBackground(DEFAULT_SOLID);
          if (value[0] === 'gradient') setBackground(DEFAULT_GRADIENT);
        }}>
          {BACKGROUND_OPTIONS.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
        </ToggleGroup>
        {background.kind === 'photo' && <FieldDescription>切换背景会移除当前照片。</FieldDescription>}
      </Field>
      <PhotoBackgroundPanel />
      {background.kind === 'solid' && <ColorField id="background-color" label="背景颜色" value={background.color} onChange={(color) => setBackground({ kind: 'solid', color })} />}
      {background.kind === 'gradient' && <GradientFields background={background} onChange={setBackground} />}
    </FieldGroup>
  );
}
