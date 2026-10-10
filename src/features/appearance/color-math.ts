/** 颜色换算。输入输出都对齐数据契约：颜色以 #rrggbb 十六进制保存。 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** 色相 0–360 */
  h: number;
  /** 饱和度 0–100 */
  s: number;
  /** 明度 0–100 */
  v: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 解析 #rrggbb；无法解析时返回 null，由调用方决定如何处理。 */
export function parseHex(hex: string): Rgb | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;

  const digits = match[1];
  if (digits === undefined) return null;

  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

export function toHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');

  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/**
 * 转成 HSV。
 *
 * 返回浮点值而不是取整：HSV 是取色器的内部状态，若在这里取整，`hex → HSV → hex`
 * 会有最多 3/255 的通道漂移，用户只拖动色相也会让颜色整体偏移。取整留给显示层。
 */
export function rgbToHsv(rgb: Rgb): Hsv {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }

  return {
    h: (((h * 60) % 360) + 360) % 360,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  };
}

export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  const sector = Math.floor(h / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sector] ?? [0, 0, 0];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** 解析失败时回退到中性灰，避免取色器在异常值上无法渲染。 */
export function hexToHsv(hex: string): Hsv {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsv(rgb) : { h: 0, s: 0, v: 50 };
}

export function hsvToHex(hsv: Hsv): string {
  return toHex(hsvToRgb(hsv));
}

/** 面板底色的 CSS：纯色相 + 横向白→透明 + 纵向透明→黑。 */
export function hueCss(h: number): string {
  return `hsl(${((h % 360) + 360) % 360} 100% 50%)`;
}
