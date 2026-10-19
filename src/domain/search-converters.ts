import { fail } from '@/domain/errors';

type Dimension = 'length' | 'mass' | 'temperature' | 'duration' | 'data';
interface Unit { readonly dimension: Dimension; readonly toBase: (value: number) => number; readonly fromBase: (value: number) => number }
const MILLIMETERS_PER_METER = 1000;
const METERS_PER_KILOMETER = 1000;
const GRAMS_PER_KILOGRAM = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const BYTES_PER_KILOBYTE = 1000;
const BYTES_PER_KIBIBYTE = 1024;
const FAHRENHEIT_OFFSET = 32;
const KELVIN_OFFSET = 273.15;
const FAHRENHEIT_SCALE_NUMERATOR = 5;
const FAHRENHEIT_SCALE_DENOMINATOR = 9;
const scale = (dimension: Exclude<Dimension, 'temperature'>, multiplier: number): Unit => ({ dimension,
  toBase: (value) => value * multiplier, fromBase: (value) => value / multiplier });
const UNITS: Readonly<Record<string, Unit>> = {
  mm: scale('length', 1 / MILLIMETERS_PER_METER), cm: scale('length', 0.01), m: scale('length', 1), km: scale('length', METERS_PER_KILOMETER),
  in: scale('length', 0.0254), ft: scale('length', 0.3048), yd: scale('length', 0.9144), mi: scale('length', 1609.344),
  mg: scale('mass', 0.001), g: scale('mass', 1), kg: scale('mass', GRAMS_PER_KILOGRAM), oz: scale('mass', 28.349523125), lb: scale('mass', 453.59237),
  ms: scale('duration', 0.001), s: scale('duration', 1), sec: scale('duration', 1), min: scale('duration', 60),
  h: scale('duration', SECONDS_PER_HOUR), hr: scale('duration', SECONDS_PER_HOUR), d: scale('duration', SECONDS_PER_DAY), day: scale('duration', SECONDS_PER_DAY),
  b: scale('data', 1), kb: scale('data', BYTES_PER_KILOBYTE), mb: scale('data', BYTES_PER_KILOBYTE ** 2), gb: scale('data', BYTES_PER_KILOBYTE ** 3), tb: scale('data', BYTES_PER_KILOBYTE ** 4),
  kib: scale('data', BYTES_PER_KIBIBYTE), mib: scale('data', BYTES_PER_KIBIBYTE ** 2), gib: scale('data', BYTES_PER_KIBIBYTE ** 3), tib: scale('data', BYTES_PER_KIBIBYTE ** 4),
  c: { dimension: 'temperature', toBase: (value) => value + KELVIN_OFFSET, fromBase: (value) => value - KELVIN_OFFSET },
  f: { dimension: 'temperature', toBase: (value) => (value - FAHRENHEIT_OFFSET) * FAHRENHEIT_SCALE_NUMERATOR / FAHRENHEIT_SCALE_DENOMINATOR + KELVIN_OFFSET,
    fromBase: (value) => (value - KELVIN_OFFSET) * FAHRENHEIT_SCALE_DENOMINATOR / FAHRENHEIT_SCALE_NUMERATOR + FAHRENHEIT_OFFSET },
  k: { dimension: 'temperature', toBase: (value) => value, fromBase: (value) => value },
};
const UNIT_PATTERN = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([a-z]+)\s+to\s+([a-z]+)\s*$/i;

export type ConversionMatch =
  | { readonly matched: false }
  | { readonly matched: true; readonly value: string; readonly label: string }
  | { readonly matched: true; readonly error: string };

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
