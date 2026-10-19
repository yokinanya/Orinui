import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';
import { createToolAction, isEnabled, toolResults } from '@/domain/search-tool-utils';

const GROUP: SearchToolGroup = 'datetime';
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/i;
const UNIX_INPUT = /^(unixms|unix):([+-]?\d+(?:\.\d+)?)$/i;
const DATE_SHIFT = /^(?:date\s+|日期\s+)(\d{4}-\d{2}-\d{2})\s+([+-])\s*(\d+)(d|w|天|周|星期)$/i;
const DATE_DIFF = /^(?:datediff\s+|日期差\s+)(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/i;
const UNIX_MILLISECONDS_PER_SECOND = 1000;
const DATE_MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const UNIX_SECONDS_LENGTH = 10;
const UNIX_MILLISECONDS_LENGTH = 13;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const NUMERIC_CANDIDATE = new RegExp(`^(?:\\d{${UNIX_SECONDS_LENGTH}}|\\d{${UNIX_MILLISECONDS_LENGTH}})$`);

function action(input: { readonly actionId: string; readonly kind: 'copy' | 'error'; readonly label: string; readonly value: string; readonly detail: string }) {
  return createToolAction({ toolId: 'datetime', group: GROUP, ...input });
}

function error(detail: string, explicit: boolean): SearchToolResults {
  const item = action({ actionId: 'error', kind: 'error', label: '日期时间格式无效', value: '', detail });
  return toolResults([item], explicit, item.id);
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function localTime(date: Date, timeZone: string, showZone: boolean): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', ...(showZone ? { timeZoneName: 'short' } : {}) }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const value = `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
  return showZone ? `${value} ${fields.timeZoneName}` : value;
}

function copyFormats(input: { readonly date: Date; readonly context: SearchToolContext; readonly explicit: boolean; readonly showZone?: boolean }): SearchToolResults {
  const { date, context, explicit, showZone = false } = input;
  if (!isValidDate(date)) return error('日期时间超出可表示范围', explicit);
  try {
    const local = localTime(date, context.timeZone, showZone);
    const seconds = String(Math.floor(date.getTime() / UNIX_MILLISECONDS_PER_SECOND));
    const milliseconds = String(date.getTime());
    const actions = [
      action({ actionId: 'local', kind: 'copy', label: `复制本地时间（${context.timeZone}）`, value: local, detail: local }),
      action({ actionId: 'iso', kind: 'copy', label: '复制 ISO 8601', value: date.toISOString(), detail: date.toISOString() }),
      action({ actionId: 'unix', kind: 'copy', label: '复制 Unix 秒', value: seconds, detail: seconds }),
      action({ actionId: 'unixms', kind: 'copy', label: '复制 Unix 毫秒', value: milliseconds, detail: milliseconds }),
    ];
    return toolResults(actions, explicit, actions[0]!.id);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), explicit);
  }
}

function hasInvalidClock(match: RegExpExecArray): boolean {
  return Number(match[2]) >= HOURS_PER_DAY || Number(match[3]) >= MINUTES_PER_HOUR
    || (match[4] !== undefined && Number(match[4]) >= MINUTES_PER_HOUR);
}

function hasInvalidOffset(match: RegExpExecArray): boolean {
  return match[5] !== undefined
    && (Number(match[7]) >= HOURS_PER_DAY || Number(match[8]) >= MINUTES_PER_HOUR);
}

function parseStrictIso(value: string): Date | null {
  const match = ISO_DATETIME.exec(value);
  if (!match) return null;
  if (dateEpoch(match[1]!) === null || hasInvalidClock(match) || hasInvalidOffset(match)) return new Date(Number.NaN);
  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : new Date(Number.NaN);
}

function parseUnix(value: string): Date | null {
  const match = UNIX_INPUT.exec(value.trim());
  if (!match) return null;
  const input = Number(match[2]);
  const timestamp = match[1]!.toLowerCase() === 'unix' ? input * UNIX_MILLISECONDS_PER_SECOND : input;
  return new Date(Number.isFinite(timestamp) ? timestamp : Number.NaN);
}

function dateEpoch(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) return null;
  return epoch;
}

function parseDateCommand(query: string): SearchToolResults | null {
  const shift = DATE_SHIFT.exec(query.trim());
  if (shift) {
    const epoch = dateEpoch(shift[1]!);
    if (epoch === null) return error('日期无效', true);
    const amount = Number(shift[3]);
    const unit = shift[4]!.toLowerCase();
    const days = amount * (['w', '周', '星期'].includes(unit) ? DAYS_PER_WEEK : 1) * (shift[2] === '-' ? -1 : 1);
    const shiftedDate = new Date(epoch + days * DATE_MILLISECONDS_PER_DAY);
    if (!Number.isSafeInteger(days) || !isValidDate(shiftedDate)) return error('日期偏移超出可表示范围', true);
    const shifted = shiftedDate.toISOString().split('T')[0]!;
    const weekday = new Intl.DateTimeFormat('zh-HK', { timeZone: 'UTC', weekday: 'long' }).format(shiftedDate);
    const item = action({ actionId: 'date-shift', kind: 'copy', label: `复制日期（${weekday}）`, value: shifted, detail: `${shifted} ${weekday}` });
    return toolResults([item], true, item.id);
  }
  const difference = DATE_DIFF.exec(query.trim());
  if (!difference) return null;
  const first = dateEpoch(difference[1]!);
  const second = dateEpoch(difference[2]!);
  if (first === null || second === null) return error('日期无效', true);
  const days = (second - first) / DATE_MILLISECONDS_PER_DAY;
  const item = action({ actionId: 'date-difference', kind: 'copy', label: '复制相差天数', value: String(days), detail: `${difference[2]} − ${difference[1]} 天` });
  return toolResults([item], true, item.id);
}

function parseTimestampCommand(query: string, context: SearchToolContext): SearchToolResults | null {
  const trimmed = query.trim();
  if (/^ts\s+now$/i.test(trimmed)) return copyFormats({ date: context.now, context, explicit: true });
  const explicit = /^(?:ts|unix|unixms)\b/i.test(trimmed);
  const value = /^ts\s+(.+)$/i.exec(trimmed)?.[1] ?? trimmed;
  const date = parseUnix(value) ?? parseStrictIso(value);
  if (!date) return explicit ? error('用法：ts now、ts <ISO时间>、unix:<秒> 或 unixms:<毫秒>', true) : null;
  return copyFormats({ date, context, explicit });
}

function numericTimestampCandidate(query: string): SearchToolResults | null {
  const value = query.trim();
  if (!NUMERIC_CANDIDATE.test(value)) return null;
  const milliseconds = value.length === UNIX_MILLISECONDS_LENGTH;
  const date = new Date(Number(value) * (milliseconds ? 1 : UNIX_MILLISECONDS_PER_SECOND));
  if (!isValidDate(date)) return null;
  const item = action({ actionId: 'numeric-candidate', kind: 'copy', label: `可能是 Unix ${milliseconds ? '毫秒' : '秒'}时间戳`, value: date.toISOString(), detail: date.toISOString() });
  return toolResults([item], false);
}

function timezoneConversion(query: string, context: SearchToolContext): SearchToolResults | null {
  const match = /^(ts\s+)?(.+?)\s+to\s+(.+)$/i.exec(query.trim());
  if (!match) return null;
  const date = parseStrictIso(match[2]!);
  if (!date) return null;
  const target = match[3]!;
  const result = copyFormats({ date, context: { ...context, timeZone: target }, explicit: true, showZone: true });
  return result.actions[0]?.kind === 'error' ? result : toolResults(result.actions, true, result.preferredId);
}

function isDatetimeCommand(query: string): boolean {
  const value = query.trim();
  return /^(?:ts|unix|unixms|date|datediff)\b/i.test(value) || /^(?:日期|日期差)(?:\s|$)/.test(value);
}

export function parseDateTimeTool(
  query: string,
  context: SearchToolContext,
  enabled: readonly SearchToolGroup[],
): SearchToolResults | null {
  const explicit = isDatetimeCommand(query);
  const trimmed = query.trim();
  const result = parseDateCommand(trimmed) ?? timezoneConversion(trimmed, context)
    ?? parseTimestampCommand(trimmed, context)
    ?? numericTimestampCandidate(trimmed);
  if (!result) return explicit ? error('日期命令格式无效，请使用日期示例或 ts now', true) : null;
  if (!isEnabled(GROUP, enabled)) return explicit || result.explicit ? error('日期时间工具已关闭', true) : null;
  return result;
}
