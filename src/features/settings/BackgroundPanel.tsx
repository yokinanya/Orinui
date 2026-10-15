import { useEffect, useState } from 'react';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Background, GradientBackground } from '@/domain/appearance';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { useAppearanceActions } from '@/features/settings/appearance-actions';
import { PhotoBackgroundPanel } from '@/features/settings/PhotoBackgroundPanel';
import { MotionBackgroundPanel } from '@/features/settings/MotionBackgroundPanel';

const DEFAULT_SOLID = { kind: 'solid', color: '#f2ece3' } as const;
const DEFAULT_GRADIENT = { kind: 'gradient', from: '#f4efe6', to: '#c9d6e4', angle: 160 } as const;
const FULL_TURN_DEGREES = 360;
const BACKGROUND_OPTIONS = [
  { value: 'default', label: '默认' }, { value: 'solid', label: '纯色' },
  { value: 'gradient', label: '渐变' }, { value: 'photo', label: '图片' },
  { value: 'motion', label: '动态壁纸' },
] as const;

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
  const [requestedKind, setRequestedKind] = useState<'photo' | 'motion' | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const selectedKind: Background['kind'] = requestedKind ?? background.kind;
  const setBackground = (next: Background) => update({ background: next });
  useEffect(() => {
    if (background.kind === 'photo' || background.kind === 'motion') setRequestedKind(null);
  }, [background.kind]);

  const selectKind = (value: string[]) => {
    const next = BACKGROUND_OPTIONS.find((option) => option.value === value[0])?.value;
    if (!next) return;
    setRequestedKind(next === 'photo' || next === 'motion' ? next : null);
    if (next === 'photo' || next === 'motion') return;
    if (next === 'default') setBackground({ kind: 'default' });
    if (next === 'solid') setBackground(DEFAULT_SOLID);
    if (next === 'gradient') setBackground(DEFAULT_GRADIENT);
  };

  return (
    <FieldGroup>
      <Field>
        <FieldLabel id="background-kind-label">背景类型</FieldLabel>
        <ToggleGroup aria-labelledby="background-kind-label" value={[selectedKind]}
          disabled={photoBusy} className="settings-segmented w-full flex-wrap gap-1" onValueChange={selectKind}>
          {BACKGROUND_OPTIONS.map((option) => <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
            {option.label}
          </ToggleGroupItem>)}
        </ToggleGroup>
        {background.kind === 'photo' && selectedKind !== 'photo'
          && <FieldDescription>切换类型会移除当前图片。</FieldDescription>}
      </Field>
      {selectedKind === 'photo' && <PhotoBackgroundPanel onBusyChange={setPhotoBusy} />}
      {selectedKind === 'motion' && <MotionBackgroundPanel onBusyChange={setPhotoBusy} />}
      {selectedKind === 'solid' && <ColorField id="background-color" label="背景颜色"
        value={background.kind === 'solid' ? background.color : DEFAULT_SOLID.color}
        onChange={(color) => setBackground({ kind: 'solid', color })} />}
      {selectedKind === 'gradient' && <GradientFields
        background={background.kind === 'gradient' ? background : DEFAULT_GRADIENT} onChange={setBackground} />}
    </FieldGroup>
  );
}
