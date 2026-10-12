import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ClockFormat } from '@/domain/settings';
import { useData } from '@/app/data-context';
import { notifyError } from '@/lib/notify';

const OPTIONS: readonly { value: ClockFormat; label: string }[] = [
  { value: 'system', label: '跟随系统' }, { value: '12h', label: '12 小时' }, { value: '24h', label: '24 小时' },
];

export function ClockSettingsPanel() {
  const { settings, updateClockFormat } = useData();
  return (
    <Field>
      <FieldLabel>时钟格式</FieldLabel>
      <ToggleGroup className="w-full gap-1" value={[settings.clock.format]} onValueChange={(value) => {
        const format = value[0];
        if (format === 'system' || format === '12h' || format === '24h') void updateClockFormat(format).catch(notifyError);
      }}>
        {OPTIONS.map((option) => <ToggleGroupItem className="min-w-0 flex-1 px-0.5 whitespace-normal" key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  );
}
