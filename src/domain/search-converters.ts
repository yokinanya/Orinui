import { fail } from '@/domain/errors';

type Dimension = 'length' | 'mass' | 'temperature' | 'duration' | 'data';
interface Unit { readonly dimension: Dimension; readonly toBase: (value: number) => number; readonly fromBase: (value: number) => number }
const scale = (dimension: Exclude<Dimension, 'temperature'>, multiplier: number): Unit => ({ dimension,
  toBase: (value) => value * multiplier, fromBase: (value) => value / multiplier });
const UNITS: Readonly<Record<string, Unit>> = {
  mm: scale('length', 0.001), cm: scale('length', 0.01), m: scale('length', 1), km: scale('length', 1000),
  in: scale('length', 0.0254), ft: scale('length', 0.3048), yd: scale('length', 0.9144), mi: scale('length', 1609.344),
  mg: scale('mass', 0.001), g: scale('mass', 1), kg: scale('mass', 1000), oz: scale('mass', 28.349523125), lb: scale('mass', 453.59237),
  ms: scale('duration', 0.001), s: scale('duration', 1), sec: scale('duration', 1), min: scale('duration', 60),
  h: scale('duration', 3600), hr: scale('duration', 3600), d: scale('duration', 86400), day: scale('duration', 86400),
  b: scale('data', 1), kb: scale('data', 1000), mb: scale('data', 1_000_000), gb: scale('data', 1_000_000_000), tb: scale('data', 1_000_000_000_000),
  kib: scale('data', 1024), mib: scale('data', 1_048_576), gib: scale('data', 1_073_741_824), tib: scale('data', 1_099_511_627_776),
  c: { dimension: 'temperature', toBase: (value) => value + 273.15, fromBase: (value) => value - 273.15 },
  f: { dimension: 'temperature', toBase: (value) => (value - 32) * 5 / 9 + 273.15, fromBase: (value) => (value - 273.15) * 9 / 5 + 32 },
  k: { dimension: 'temperature', toBase: (value) => value, fromBase: (value) => value },
};
const UNIT_PATTERN = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([a-z]+)\s+to\s+([a-z]+)\s*$/i;
const ISO_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))\s+to\s+([a-z_+-]+(?:\/[a-z0-9_+-]+)*)$/i;
const UNIX_PATTERN = /^unix(ms)?:([+-]?\d+(?:\.\d+)?)$/i;

export interface ConversionMatch {
  readonly matched: boolean;
  readonly value?: string;
  readonly label?: string;
  readonly error?: string;
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) fail('换算结果超出可表示范围');
  return String(Number(value.toPrecision(12)));
}

function convertTemperature(value: number, from: string, to: string): number {
  const unit = UNITS[from];
  const target = UNITS[to];
  if (!unit || !target || unit.dimension !== 'temperature' || target.dimension !== 'temperature') fail('单位不匹配或不受支持');
  return target.fromBase(unit.toBase(value));
}

export function convertSearchUnit(query: string): ConversionMatch {
  const match = UNIT_PATTERN.exec(query);
  if (!match) return { matched: false };
  try {
    const value = Number(match[1]);
    const from = match[2]!.toLowerCase();
    const to = match[3]!.toLowerCase();
    if (!Number.isFinite(value)) fail('数值无效');
    const source = UNITS[from];
    const target = UNITS[to];
    if (!source || !target || source.dimension !== target.dimension) fail('单位不匹配或不受支持');
    const converted = source.dimension === 'temperature' ? convertTemperature(value, from, to)
      : target.fromBase(source.toBase(value));
    return { matched: true, value: numberText(converted), label: `${match[3]} 换算结果` };
  } catch (cause) {
    return { matched: true, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function formatZonedTime(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
  const parts = new Intl.DateTimeFormat('en', options).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second} ${timeZone}`;
}

function convertIsoTime(query: string): ConversionMatch | null {
  const match = ISO_TIME_PATTERN.exec(query);
  if (!match) return null;
  const date = new Date(match[1]!);
  if (!Number.isFinite(date.getTime())) return { matched: true, error: '日期时间无效' };
  const timeZone = match[2]!;
  try {
    const result = formatZonedTime(date, timeZone);
    return { matched: true, value: result, label: '时区换算结果' };
  } catch (cause) {
    return { matched: true, error: cause instanceof Error ? `时区不受支持：${timeZone}` : String(cause) };
  }
}

function convertUnixTime(query: string): ConversionMatch | null {
  const match = UNIX_PATTERN.exec(query.trim());
  if (!match) return null;
  const input = Number(match[2]);
  const milliseconds = match[1] ? input : input * 1000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(date.getTime())) return { matched: true, error: '时间戳超出日期范围' };
  return { matched: true, value: `${date.toISOString()} · ${formatZonedTime(date, Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
    label: '时间戳换算结果' };
}

export function convertSearchDateTime(query: string): ConversionMatch {
  return convertIsoTime(query) ?? convertUnixTime(query) ?? { matched: false };
}
