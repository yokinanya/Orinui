import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';
import { parseColor, rgbToHsl } from '@/domain/search-color-parse';
import type { Color } from '@/domain/search-color-parse';
import { createToolAction, isEnabled, toolResults } from '@/domain/search-tool-utils';

const GROUP: SearchToolGroup = 'color';
const CHANNEL_MAX = 255;
const ALPHA_MAX = 1;
const HEX_RADIX = 16;
const WCAG_BLACK_OFFSET = 0.05;
const WCAG_CHANNEL_THRESHOLD = 0.04045;
const WCAG_LINEAR_DIVISOR = 12.92;
const WCAG_GAMMA_OFFSET = 0.055;
const WCAG_GAMMA_DIVISOR = 1.055;
const WCAG_GAMMA = 2.4;
const NORMAL_TEXT_AA = 4.5;
const NORMAL_TEXT_AAA = 7;
const LARGE_TEXT_AA = 3;
const RED_LUMINANCE_WEIGHT = 0.2126;
const GREEN_LUMINANCE_WEIGHT = 0.7152;
const BLUE_LUMINANCE_WEIGHT = 0.0722;

function action(input: { readonly actionId: string; readonly label: string; readonly value: string; readonly color: Color }) {
  return createToolAction({ toolId: 'color', group: GROUP, actionId: input.actionId, kind: 'copy', label: input.label,
    value: input.value, detail: input.value, swatch: cssColor(input.color) });
}

function error(detail: string): SearchToolResults {
  const item = createToolAction({ toolId: 'color', group: GROUP, actionId: 'error', kind: 'error',
    label: '颜色输入无效', value: '', detail });
  return toolResults([item], true, item.id);
}

function alphaText(alpha: number): string {
  return alpha === ALPHA_MAX ? '' : ` / ${Number(alpha.toFixed(4))}`;
}

function cssColor(color: Color): string {
  return color.alpha === ALPHA_MAX ? toHex(color, false)
    : `rgb(${Math.round(color.red * 255)} ${Math.round(color.green * 255)} ${Math.round(color.blue * 255)} / ${Number(color.alpha.toFixed(4))})`;
}

function toHex(color: Color, keepAlpha: boolean): string {
  const channelHex = (value: number) => Math.round(value * CHANNEL_MAX).toString(HEX_RADIX).padStart(2, '0');
  const alpha = keepAlpha && color.alpha < ALPHA_MAX ? channelHex(color.alpha) : '';
  return `#${channelHex(color.red)}${channelHex(color.green)}${channelHex(color.blue)}${alpha}`;
}

function formattedActions(color: Color, explicit: boolean): SearchToolResults {
  const [hue, saturation, lightness] = rgbToHsl(color);
  const rgb = `rgb(${Math.round(color.red * CHANNEL_MAX)} ${Math.round(color.green * CHANNEL_MAX)} ${Math.round(color.blue * CHANNEL_MAX)}${alphaText(color.alpha)})`;
  const hsl = `hsl(${hue} ${saturation}% ${lightness}%${alphaText(color.alpha)})`;
  const actions = [action({ actionId: 'hex', label: '复制 HEX', value: toHex(color, true), color }),
    action({ actionId: 'rgb', label: '复制 RGB', value: rgb, color }),
    action({ actionId: 'hsl', label: '复制 HSL', value: hsl, color })];
  const preferred = color.format === 'hex' ? actions[1]! : actions[0]!;
  return toolResults(actions, explicit, preferred.id);
}

function luminance(color: Color): number {
  const linear = (value: number) => value <= WCAG_CHANNEL_THRESHOLD ? value / WCAG_LINEAR_DIVISOR
    : ((value + WCAG_GAMMA_OFFSET) / WCAG_GAMMA_DIVISOR) ** WCAG_GAMMA;
  return RED_LUMINANCE_WEIGHT * linear(color.red) + GREEN_LUMINANCE_WEIGHT * linear(color.green)
    + BLUE_LUMINANCE_WEIGHT * linear(color.blue);
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  const blend = (front: number, back: number) => (front * foreground.alpha + back * background.alpha * (1 - foreground.alpha)) / alpha;
  return { red: blend(foreground.red, background.red), green: blend(foreground.green, background.green),
    blue: blend(foreground.blue, background.blue), alpha: 1, format: 'rgb' };
}

function contrastValues(query: string): { readonly foreground: string; readonly background: string } | null {
  const match = /^(?:contrast\s+(.+)\s+on\s+(.+)|对比度\s+(#[\da-f]{3,8}|(?:rgba?|hsla?)\([^)]*\))\s+(#[\da-f]{3,8}|(?:rgba?|hsla?)\([^)]*\)))$/i.exec(query.trim());
  if (!match) return null;
  return { foreground: match[1] ?? match[3]!, background: match[2] ?? match[4]! };
}

function contrastStatus(ratio: number): string {
  const normalAA = ratio >= NORMAL_TEXT_AA ? '通过' : '不通过';
  const normalAAA = ratio >= NORMAL_TEXT_AAA ? '通过' : '不通过';
  const largeAA = ratio >= LARGE_TEXT_AA ? '通过' : '不通过';
  return `WCAG AA 正文 ${normalAA}；AAA 正文 ${normalAAA}；大型文字 AA ${largeAA}`;
}

function contrastResult(input: { readonly foreground: string; readonly background: string }): SearchToolResults {
  const foreground = parseColor(input.foreground);
  const background = parseColor(input.background);
  if (!foreground || !background) return error('用法：对比度 <前景色> <背景色>');
  if (background.alpha < ALPHA_MAX) return error('背景色必须不透明，不能假设白色或其他底色');
  const visibleForeground = foreground.alpha < ALPHA_MAX ? composite(foreground, background) : foreground;
  const values = [luminance(visibleForeground), luminance(background)].sort((a, b) => b - a);
  const ratio = (values[0]! + WCAG_BLACK_OFFSET) / (values[1]! + WCAG_BLACK_OFFSET);
  const rounded = ratio.toFixed(2);
  const detail = contrastStatus(ratio);
  const item = createToolAction({ toolId: 'color', group: GROUP, actionId: 'contrast', kind: 'copy',
    label: `${rounded}:1 对比度`, value: `${rounded}:1`, detail,
    contrast: input });
  return toolResults([item], true, item.id);
}

function parseContrast(query: string): SearchToolResults | null {
  const values = contrastValues(query);
  return values ? contrastResult(values) : null;
}

function parseContrastCommand(query: string, enabled: readonly SearchToolGroup[]): SearchToolResults | null {
  if (!/^(?:contrast\b|对比度)/i.test(query)) return null;
  if (!isEnabled(GROUP, enabled)) return error('颜色工具已关闭');
  return parseContrast(query) ?? error('用法：对比度 <前景色> <背景色>');
}

function parseColorInput(query: string, enabled: readonly SearchToolGroup[]): SearchToolResults | null {
  const explicit = /^(?:color\b|颜色)/i.test(query);
  const input = explicit ? query.replace(/^(?:color\b|颜色)\s*/i, '') : query;
  const parsed = parseColor(input);
  if (!parsed) return explicit ? error('用法：color <HEX、RGB 或 HSL 值>') : null;
  if (!isEnabled(GROUP, enabled)) return explicit ? error('颜色工具已关闭') : null;
  return formattedActions(parsed, explicit);
}

export function parseColorTool(
  query: string,
  context: SearchToolContext,
  enabled: readonly SearchToolGroup[],
): SearchToolResults | null {
  void context;
  const trimmed = query.trim();
  return parseContrastCommand(trimmed, enabled) ?? parseColorInput(trimmed, enabled);
}
