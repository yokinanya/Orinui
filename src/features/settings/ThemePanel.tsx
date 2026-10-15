import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ThemeMode } from '@/domain/appearance';
import { useAppearanceActions } from '@/features/settings/appearance-actions';

const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export function ThemePanel() {
  const { appearance, update } = useAppearanceActions();
  return (
    <Field>
      <FieldLabel>主题</FieldLabel>
      <ToggleGroup className="settings-segmented" value={[appearance.theme]} onValueChange={(value) => {
        const next = value[0];
        if (next === 'system' || next === 'light' || next === 'dark') update({ theme: next });
      }}>
        {THEME_OPTIONS.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  );
}
