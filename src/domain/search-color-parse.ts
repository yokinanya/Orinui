export interface Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
  readonly format: 'hex' | 'rgb' | 'hsl';
}

const RGB_CHANNEL_MAX = 255;
const ALPHA_MAX = 1;
const HSL_TURN = 360;
const HSL_SECTORS = 6;
const PERCENT = 100;
const NUMBER_COMPONENT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;

function parseHex(value: string): Color | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (!match) return null;
  const raw = match[1]!;
  const expanded = raw.length <= 4 ? [...raw].map((digit) => `${digit}${digit}`).join('') : raw;
  const alpha = expanded.length === 8 ? parseInt(expanded.slice(6), 16) / RGB_CHANNEL_MAX : ALPHA_MAX;
  return { red: parseInt(expanded.slice(0, 2), 16) / RGB_CHANNEL_MAX,
    green: parseInt(expanded.slice(2, 4), 16) / RGB_CHANNEL_MAX,
    blue: parseInt(expanded.slice(4, 6), 16) / RGB_CHANNEL_MAX, alpha, format: 'hex' };
}

function channel(value: string): number | null {
  if (!NUMBER_COMPONENT.test(value)) return null;
  const numeric = value.endsWith('%') ? Number(value.slice(0, -1)) * RGB_CHANNEL_MAX / PERCENT : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > RGB_CHANNEL_MAX) return null;
  return numeric / RGB_CHANNEL_MAX;
}

function alphaValue(value: string | undefined): number | null {
  if (value === undefined) return ALPHA_MAX;
  if (!NUMBER_COMPONENT.test(value)) return null;
  const numeric = value.endsWith('%') ? Number(value.slice(0, -1)) / PERCENT : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= ALPHA_MAX ? numeric : null;
}

interface ColorComponents { readonly parts: string[]; readonly values: string[]; readonly slash: number }

function splitColorParts(source: string): string[] {
  if (source.includes(',')) return source.split(',').map((part) => part.trim());
  return source.replace('/', ' / ').split(/\s+/).filter(Boolean);
}

function hasInvalidColorParts(source: string, value: string, parts: readonly string[]): boolean {
  const commaSyntax = source.includes(',');
  if (parts.some((part) => !part) || (commaSyntax && source.includes('/'))) return true;
  if (commaSyntax && parts.length === 4 && !/^(?:rgba|hsla)\(/i.test(value)) return true;
  return false;
}

function hasInvalidColorArity(parts: readonly string[], commaSyntax: boolean): boolean {
  const slash = parts.indexOf('/');
  const values = slash < 0 ? parts : parts.slice(0, slash);
  const commaAlpha = commaSyntax && values.length === 4;
  return (slash >= 0 && (slash !== 3 || parts.length !== 5))
    || (slash < 0 && values.length === 4 && !commaAlpha);
}

function colorComponents(value: string): ColorComponents | null {
  const match = /^(rgba?|hsla?)\((.*)\)$/i.exec(value);
  if (!match) return null;
  const source = match[2]!.trim();
  const commaSyntax = source.includes(',');
  const parts = splitColorParts(source);
  if (hasInvalidColorParts(source, value, parts) || hasInvalidColorArity(parts, commaSyntax)) return null;
  const slash = parts.indexOf('/');
  const values = slash < 0 ? parts : parts.slice(0, slash);
  return { parts, values, slash };
}

function hasRgbArity(values: readonly string[], slash: number): boolean {
  return values.length === 3 || (slash < 0 && values.length === 4);
}

function rgbChannels(values: readonly string[]): readonly [number, number, number] | null {
  const channels = [channel(values[0] ?? ''), channel(values[1] ?? ''), channel(values[2] ?? '')];
  if (channels.some((value) => value === null)) return null;
  return channels as [number, number, number];
}

function parseRgb(value: string): Color | null {
  const data = colorComponents(value);
  if (!data || !/^rgba?\(/i.test(value)) return null;
  const { values, parts, slash } = data;
  const alpha = alphaValue(slash < 0 ? values[3] : parts[slash + 1]);
  const channels = rgbChannels(values);
  if (!hasRgbArity(values, slash) || alpha === null || !channels) return null;
  const [red, green, blue] = channels;
  return { red, green, blue, alpha, format: 'rgb' };
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const normalized = ((hue % HSL_TURN) + HSL_TURN) % HSL_TURN / HSL_TURN;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = normalized * HSL_SECTORS;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const offset = lightness - chroma / 2;
  const sectors: readonly (readonly [number, number, number])[] = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ];
  const values = sectors[Math.floor(segment)]!;
  return [values[0]! + offset, values[1]! + offset, values[2]! + offset];
}

function parseHsl(value: string): Color | null {
  const data = colorComponents(value);
  if (!data || !/^hsla?\(/i.test(value)) return null;
  const { values, parts, slash } = data;
  const hue = Number((values[0] ?? '').replace(/deg$/i, ''));
  const saturation = Number((values[1] ?? '').replace('%', '')) / PERCENT;
  const lightness = Number((values[2] ?? '').replace('%', '')) / PERCENT;
  const alpha = alphaValue(slash < 0 ? values[3] : parts[slash + 1]);
  if (!isValidHslInput({ values, slash, hue, saturation, lightness, alpha })) return null;
  const [red, green, blue] = hslToRgb(hue, saturation, lightness);
  return { red, green, blue, alpha: alpha!, format: 'hsl' };
}

function hasHslTokens(values: readonly string[]): boolean {
  const huePattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg)?$/i;
  const percentPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/;
  return [huePattern, percentPattern, percentPattern].every((pattern, index) => pattern.test(values[index] ?? ''));
}

function isValidHslInput(input: {
  readonly values: readonly string[]; readonly slash: number; readonly hue: number; readonly saturation: number;
  readonly lightness: number; readonly alpha: number | null;
}): boolean {
  return hasRgbArity(input.values, input.slash) && Number.isFinite(input.hue)
    && hasHslTokens(input.values)
    && [input.saturation, input.lightness].every((value) => value >= 0 && value <= ALPHA_MAX)
    && input.alpha !== null;
}

export function parseColor(value: string): Color | null {
  return parseHex(value) ?? parseRgb(value) ?? parseHsl(value);
}

export function rgbToHsl(color: Color): readonly [number, number, number] {
  const { red, green, blue } = color;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue = delta === 0 ? 0 : max === red ? 60 * (((green - blue) / delta) % 6)
    : max === green ? 60 * ((blue - red) / delta + 2) : 60 * ((red - green) / delta + 4);
  return [Math.round((hue + HSL_TURN) % HSL_TURN), Math.round(saturation * PERCENT), Math.round(lightness * PERCENT)];
}
