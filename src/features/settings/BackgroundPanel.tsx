import { useState } from 'react';
import { ArrowRight, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { BackgroundTypePicker, BACKGROUND_OPTIONS, type BackgroundChoice } from '@/features/settings/BackgroundTypePicker';
import type { Background, GradientBackground } from '@/domain/appearance';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { useAppearanceActions } from '@/features/settings/appearance-actions';

const DEFAULT_SOLID = { kind: 'solid', color: '#f2ece3' } as const;
const DEFAULT_GRADIENT = { kind: 'gradient', from: '#f4efe6', to: '#c9d6e4', angle: 160 } as const;
const FULL_TURN_DEGREES = 360;


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

export function BackgroundPanel({ onOpenLibrary, initialWallpaper = false }: { readonly onOpenLibrary: () => void; readonly initialWallpaper?: boolean }) {
  const { appearance, update } = useAppearanceActions();
  const { background } = appearance;
  const [requestedKind, setRequestedKind] = useState<BackgroundChoice | null>(initialWallpaper ? 'wallpaper' : null);
  const currentKind = background.kind === 'photo' || background.kind === 'motion' ? 'wallpaper' : background.kind;
  const selectedKind = requestedKind ?? currentKind;
  const setBackground = (next: Background) => update({ background: next });
  const selectKind = (value: string[]) => {
    const next = BACKGROUND_OPTIONS.find((option) => option.value === value[0])?.value;
    if (!next) return;
    setRequestedKind(next === 'wallpaper' ? next : null);
    if (next === 'default') setBackground({ kind: 'default' });
    if (next === 'solid') setBackground(DEFAULT_SOLID);
    if (next === 'gradient') setBackground(DEFAULT_GRADIENT);
  };
  return <FieldGroup>
    <BackgroundTypePicker value={selectedKind} disabled={false} onChange={selectKind} />
    {selectedKind === 'default' && <FieldDescription>使用默认中性渐变，无需联网。</FieldDescription>}
    {selectedKind === 'wallpaper' && <>
      <Button variant="outline" className="w-full justify-between" onClick={onOpenLibrary}>
        <span data-open-wallpaper-library className="flex items-center gap-2"><Images data-icon="inline-start" />打开壁纸库</span>
        <ArrowRight data-icon="inline-end" />
      </Button>
      <FieldDescription>选择素材查看详情，点击“应用壁纸”后才会更换背景。</FieldDescription>
    </>}
    {selectedKind === 'solid' && <ColorField id="background-color" label="背景颜色"
      value={background.kind === 'solid' ? background.color : DEFAULT_SOLID.color}
      onChange={(color) => setBackground({ kind: 'solid', color })} />}
    {selectedKind === 'gradient' && <GradientFields
      background={background.kind === 'gradient' ? background : DEFAULT_GRADIENT} onChange={setBackground} />}
  </FieldGroup>;
}
