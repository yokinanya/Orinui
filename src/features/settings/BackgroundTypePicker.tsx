import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Images, Palette, Blend, Sparkles } from 'lucide-react';

export type BackgroundChoice = 'default' | 'solid' | 'gradient' | 'wallpaper';

export const BACKGROUND_OPTIONS = [
  { value: 'default', label: '默认', icon: Sparkles },
  { value: 'solid', label: '纯色', icon: Palette },
  { value: 'gradient', label: '渐变', icon: Blend },
  { value: 'wallpaper', label: '壁纸', icon: Images },
] as const;

interface BackgroundTypePickerProps {
  readonly value: BackgroundChoice;
  readonly disabled: boolean;
  readonly onChange: (value: string[]) => void;
}

export function BackgroundTypePicker({ value, disabled, onChange }: BackgroundTypePickerProps) {
  return (
    <Field>
      <FieldLabel id="background-kind-label">背景类型</FieldLabel>
      <ToggleGroup aria-labelledby="background-kind-label" value={[value]} disabled={disabled}
        className="settings-preview-choices grid w-full grid-cols-2 gap-2 sm:grid-cols-4" onValueChange={onChange}>
        {BACKGROUND_OPTIONS.map(({ value: kind, label, icon: Icon }) => (
          <ToggleGroupItem key={kind} value={kind}
            className="settings-preview-choice h-auto min-w-0 flex-col gap-2 rounded-xl border p-2.5">
            <span aria-hidden="true" className={`background-type-sketch background-type-${kind}`}><Icon /></span>
            <span className="text-xs sm:text-sm">{label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
