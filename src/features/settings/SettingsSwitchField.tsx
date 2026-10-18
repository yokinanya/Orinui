import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

interface SettingsSwitchFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function SettingsSwitchField({ label, checked, onChange }: SettingsSwitchFieldProps) {
  return (
    <Field orientation="horizontal" className="min-h-10 items-center justify-between gap-3 py-1">
      <FieldLabel>{label}</FieldLabel>
      <Switch aria-label={label} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
    </Field>
  );
}
