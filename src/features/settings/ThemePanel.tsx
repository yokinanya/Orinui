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
      <ToggleGroup aria-label="主题" className="settings-preview-choices grid w-full grid-cols-3 gap-2" value={[appearance.theme]} onValueChange={(value) => {
        const next = value[0];
        if (next === 'system' || next === 'light' || next === 'dark') update({ theme: next });
      }}>
        {THEME_OPTIONS.map((option) => <ToggleGroupItem key={option.value} value={option.value}
          className="settings-preview-choice h-auto min-w-0 flex-col gap-2 rounded-xl border p-2 sm:p-2.5">
          <span aria-hidden="true" className={`theme-sketch theme-sketch-${option.value}`}>
            <span className="theme-sketch-clock">10:24</span>
            <span className="theme-sketch-search" />
            <span className="theme-sketch-sites"><i /><i /><i /><i /></span>
          </span>
          <span>{option.label}</span>
        </ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  );
}
