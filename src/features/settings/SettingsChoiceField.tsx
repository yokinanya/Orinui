import { useId } from 'react';
import { Field, FieldTitle } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SettingsChoiceFieldProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly onChange: (value: T) => void;
  readonly responsive?: boolean;
}

export function SettingsChoiceField<T extends string>({ label, value, options, onChange, responsive = false }: SettingsChoiceFieldProps<T>) {
  const labelId = useId();
  return (
    <Field orientation={responsive ? 'responsive' : 'vertical'}>
      <FieldTitle id={labelId} className="font-normal">{label}</FieldTitle>
      <ToggleGroup className={cn('settings-segmented w-full gap-1', responsive && '@md/field-group:!w-72 @md/field-group:!flex-none')}
        aria-labelledby={labelId} value={[value]} onValueChange={(next) => {
        const selected = options.find((option) => option.value === next[0]);
        if (selected) onChange(selected.value);
      }}>
        {options.map((option) => (
          <ToggleGroupItem className="min-w-0 flex-1 px-1 text-xs whitespace-nowrap sm:text-sm" key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
