import { useEffect, useState } from 'react';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useData } from '@/app/data-context';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import type { SearchCustomization } from '@/domain/search-customization';
import { notifyError } from '@/lib/notify';

const WIDTH_OPTIONS: readonly ChoiceOption<'narrow' | 'standard' | 'wide'>[] = [
  { value: 'narrow', label: '窄' }, { value: 'standard', label: '标准' }, { value: 'wide', label: '宽' },
];
const CORNER_OPTIONS: readonly ChoiceOption<SearchCustomization['corner']>[] = [
  { value: 'small', label: '小圆角' }, { value: 'standard', label: '标准' }, { value: 'pill', label: '胶囊' },
];
const OPACITY_OPTIONS: readonly ChoiceOption<'automatic' | 'manual'>[] = [
  { value: 'automatic', label: '自动' }, { value: 'manual', label: '手动' },
];

function SurfaceOpacitySetting({ value, onChange }: {
  readonly value: number | null;
  readonly onChange: (value: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? 100);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value ?? 100), [value]);
  const save = async (next: number | null) => {
    setError(null);
    try { await onChange(next); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <FieldGroup className="gap-3" data-invalid={error !== null || undefined}>
      <SettingsChoiceField label="背景不透明度模式" value={value === null ? 'automatic' : 'manual'} options={OPACITY_OPTIONS}
        onChange={(mode) => void save(mode === 'manual' ? draft : null)} />
      {value !== null && <Field data-invalid={error !== null || undefined}>
        <FieldLabel htmlFor="search-surface-opacity">不透明度：{draft}%</FieldLabel>
        <Slider id="search-surface-opacity" aria-label="搜索框背景不透明度" min={0} max={100} step={1}
          value={[draft]} onValueChange={(next) => setDraft(Array.isArray(next) ? next[0] ?? 100 : next)}
          onValueCommitted={(next) => void save(Array.isArray(next) ? next[0] ?? 100 : next)} />
        <FieldDescription>只调整搜索框背景，不改变文字透明度。</FieldDescription>
      </Field>}
      {error && <FieldError role="alert">{error}</FieldError>}
    </FieldGroup>
  );
}

function PlaceholderSetting({ value, onSave }: { readonly value: string; readonly onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const save = async () => {
    if (draft === value) return;
    setError(null);
    try { await onSave(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <Field data-invalid={error !== null || undefined}>
      <FieldLabel htmlFor="search-placeholder">提示文字</FieldLabel>
      <Input id="search-placeholder" value={draft} placeholder="可留空" aria-invalid={Boolean(error)}
        onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        }} />
      <FieldDescription>离开输入框时保存；清空后不显示提示文字。</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}

export function SearchBoxSettings() {
  const { settings, updateSearchPreferences, updateSearchCustomization } = useData();
  const customization = settings.search.customization;
  const saveCustomization = (patch: Parameters<typeof updateSearchCustomization>[0]) => updateSearchCustomization(patch);
  return (
    <FieldGroup className="gap-4">
      <SettingsChoiceField responsive label="搜索框宽度" value={settings.search.width} options={WIDTH_OPTIONS}
        onChange={(width) => void updateSearchPreferences({ width }).catch(notifyError)} />
      <SettingsChoiceField responsive label="圆角" value={customization.corner} options={CORNER_OPTIONS}
        onChange={(corner) => void saveCustomization({ corner }).catch(notifyError)} />
      <SurfaceOpacitySetting value={customization.surfaceOpacity} onChange={(surfaceOpacity) => saveCustomization({ surfaceOpacity })} />
      <PlaceholderSetting value={customization.placeholder} onSave={(placeholder) => saveCustomization({ placeholder })} />
    </FieldGroup>
  );
}
