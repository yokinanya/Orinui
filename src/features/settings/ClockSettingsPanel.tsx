import type { ClockFormat, ClockSize, DateFormat, WeekdayFormat } from '@/domain/settings';
import { FieldGroup } from '@/components/ui/field';
import { notifyError } from '@/lib/notify';
import { useData } from '@/app/data-context';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';

const FORMAT_OPTIONS: readonly ChoiceOption<ClockFormat>[] = [
  { value: 'system', label: '跟随系统' }, { value: '12h', label: '12 小时' }, { value: '24h', label: '24 小时' },
];
const SIZE_OPTIONS: readonly ChoiceOption<ClockSize>[] = [
  { value: 'small', label: '小' }, { value: 'standard', label: '标准' }, { value: 'large', label: '大' },
];
const DATE_OPTIONS: readonly ChoiceOption<DateFormat>[] = [
  { value: 'month-day', label: '月日' }, { value: 'year-month-day', label: '年月日' }, { value: 'iso', label: '数字' },
];
const WEEKDAY_OPTIONS: readonly ChoiceOption<WeekdayFormat>[] = [
  { value: 'long', label: '完整' }, { value: 'short', label: '简写' }, { value: 'english-short', label: '英文缩写' },
];

export function ClockSettingsPanel() {
  const { settings, updateClockFormat, updateClockSettings } = useData();
  const save = (patch: Parameters<typeof updateClockSettings>[0]) => void updateClockSettings(patch).catch(notifyError);
  return (
    <FieldGroup className="gap-4">
      <SettingsChoiceField responsive label="时钟格式" value={settings.clock.format} options={FORMAT_OPTIONS}
        onChange={(format) => void updateClockFormat(format).catch(notifyError)} />
      <SettingsChoiceField responsive label="时钟大小" value={settings.clock.size} options={SIZE_OPTIONS}
        onChange={(size) => save({ size })} />
      <SettingsSwitchField label="显示秒数" checked={settings.clock.showSeconds}
        onChange={(showSeconds) => save({ showSeconds })} />
      <SettingsSwitchField label="显示日期" checked={settings.clock.showDate}
        onChange={(showDate) => save({ showDate })} />
      <SettingsChoiceField responsive label="日期格式" value={settings.clock.dateFormat} options={DATE_OPTIONS}
        onChange={(dateFormat) => save({ dateFormat })} />
      <SettingsSwitchField label="显示星期" checked={settings.clock.showWeekday}
        onChange={(showWeekday) => save({ showWeekday })} />
      <SettingsChoiceField responsive label="星期格式" value={settings.clock.weekdayFormat} options={WEEKDAY_OPTIONS}
        onChange={(weekdayFormat) => save({ weekdayFormat })} />
    </FieldGroup>
  );
}
