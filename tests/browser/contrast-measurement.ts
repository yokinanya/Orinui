import { expect, type Page } from '@playwright/test';

const TEXT_CONTRAST = 4.5;
const LARGE_TEXT_AND_ICON_CONTRAST = 3;
const LARGE_TEXT_SIZE = 24;

export interface ReadabilityTarget {
  readonly selector: string;
  readonly icon?: boolean;
}

const HOMEPAGE_TARGETS: readonly ReadabilityTarget[] = [
  { selector: 'time' }, { selector: 'time + p' },
  { selector: 'section[aria-label="快捷方式"] a > span:last-child' },
  { selector: '[data-folder-tile] > span:last-child' },
  { selector: 'button[aria-label="编辑网站"]', icon: true },
  { selector: 'button[aria-label="设置"]', icon: true },
];
const PHOTO_TEXT_TARGETS = HOMEPAGE_TARGETS.slice(0, 4);
const PHOTO_CONTROL_TARGETS: readonly ReadabilityTarget[] = [
  { selector: 'button[aria-label="设置"]', icon: true },
  { selector: 'button[aria-label="编辑网站"]', icon: true },
  { selector: 'section[aria-label="快捷方式"] a > span:first-child', icon: true },
  { selector: 'form[role="search"] input' },
  { selector: 'form[role="search"] svg', icon: true },
];
const COLOR_CHANNEL_MAX = 255;
const SRGB_LINEAR_THRESHOLD = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const CONTRAST_OFFSET = 0.05;
const HALO_PIXEL_CHANGE_MIN = 8;
const MINIMUM_HALO_PIXELS = 4;
const HALO_PIXELS_PER_GLYPH = 1.5;
const RGBA_CHANNEL_COUNT = 4;
const MINIMUM_CONTRAST_RATIO = 1;
const CONTROL_GLYPH_PIXEL_MIN = 4;
const CONTROL_PIXELS_PER_CHARACTER = 1.5;
const REMOVE_GLYPHS = `time, time + p, section[aria-label="快捷方式"] a > span:first-child,
  section[aria-label="快捷方式"] a > span:last-child, form[role="search"] input,
  main button, button[aria-label="编辑网站"], button[aria-label="完成编辑"],
  [data-slot="empty-title"], [data-slot="empty-description"],
  [data-slot="empty"] button, .shortcut-grid button span,
  button[aria-label="新建文件夹"], button[aria-label$=" 的操作"],
  button[aria-label="设置"] {
    color: transparent !important; -webkit-text-fill-color: transparent !important;
    text-shadow: none !important; -webkit-text-stroke: 0 !important;
  }
  form[role="search"] input::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }
  main svg, button[aria-label="编辑网站"] svg,
  button[aria-label="完成编辑"] svg, button[aria-label="新建文件夹"] svg,
  button[aria-label$=" 的操作"] svg, button[aria-label="设置"] svg { visibility: hidden !important; }`;
const PHOTO_BACKGROUND_STYLE = `time, time + p, section[aria-label="快捷方式"] a > span:last-child {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; -webkit-text-stroke: 0 !important;
}
[data-folder-tile] > span:last-child {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; -webkit-text-stroke: 0 !important;
}
`;
const PHOTO_HALO_STYLE = `time, time + p, section[aria-label="快捷方式"] a > span:last-child {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
}
[data-folder-tile] > span:last-child {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
}
`;

async function readForegrounds(page: Page, targets: readonly ReadabilityTarget[]) {
  return page.evaluate((targets) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取名义前景色');
    return targets.map(({ selector, icon = false }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`缺少对比度目标：${selector}`);
      const style = getComputedStyle(element);
      context.fillStyle = style.color;
      context.fillRect(0, 0, 1, 1);
      const rectangle = element.getBoundingClientRect();
      const text = element instanceof HTMLInputElement ? element.value || element.placeholder : element.textContent ?? '';
      return { selector, text, foreground: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3),
        x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2,
        width: rectangle.width, height: rectangle.height,
        size: Number.parseFloat(style.fontSize), icon };
    });
  }, targets);
}

interface ScreenshotRegion {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
}

async function readScreenshotRegions(
  page: Page,
  screenshot: Buffer,
  points: Awaited<ReturnType<typeof readForegrounds>>,
): Promise<readonly ScreenshotRegion[]> {
  return page.evaluate(async ({ data, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取照片 halo 截图');
    context.drawImage(image, 0, 0);
    return points.map((point) => {
      const left = Math.max(0, Math.floor(point.x - point.width / 2));
      const top = Math.max(0, Math.floor(point.y - point.height / 2));
      const width = Math.min(image.width - left, Math.ceil(point.width));
      const height = Math.min(image.height - top, Math.ceil(point.height));
      return { width, height, pixels: Array.from(context.getImageData(left, top, width, height).data) };
    });
  }, { data: screenshot.toString('base64'), points });
}

function luminanceAt(pixels: readonly number[], offset: number): number {
  return luminance([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]);
}

function analyzePaintedPixels(background: ScreenshotRegion, painted: ScreenshotRegion, target: number) {
  let contrastingPixels = 0;
  let changedPixels = 0;
  let strongestContrast = MINIMUM_CONTRAST_RATIO;
  let maximumChange = 0;
  for (let offset = 0; offset < background.pixels.length; offset += RGBA_CHANNEL_COUNT) {
    const change = Math.max(Math.abs(background.pixels[offset]! - painted.pixels[offset]!),
      Math.abs(background.pixels[offset + 1]! - painted.pixels[offset + 1]!),
      Math.abs(background.pixels[offset + 2]! - painted.pixels[offset + 2]!));
    maximumChange = Math.max(maximumChange, change);
    if (change < HALO_PIXEL_CHANGE_MIN) continue;
    changedPixels += 1;
    const under = luminanceAt(background.pixels, offset);
    const over = luminanceAt(painted.pixels, offset);
    const ratio = (Math.max(under, over) + CONTRAST_OFFSET) / (Math.min(under, over) + CONTRAST_OFFSET);
    if (ratio < target) continue;
    contrastingPixels += 1;
    strongestContrast = Math.max(strongestContrast, ratio);
  }
  return { contrastingPixels, changedPixels, strongestContrast, maximumChange };
}

function readabilityTarget(point: Awaited<ReturnType<typeof readForegrounds>>[number]) {
  return point.icon || point.size >= LARGE_TEXT_SIZE ? LARGE_TEXT_AND_ICON_CONTRAST : TEXT_CONTRAST;
}

function analyzeHaloRegion(background: ScreenshotRegion, halo: ScreenshotRegion, point: Awaited<ReturnType<typeof readForegrounds>>[number]) {
  return { selector: point.selector, textLength: point.text.length,
    ...analyzePaintedPixels(background, halo, readabilityTarget(point)) };
}

async function readPhotoHaloContrast(page: Page, points: Awaited<ReturnType<typeof readForegrounds>>) {
  const background = await page.screenshot({ animations: 'disabled', style: PHOTO_BACKGROUND_STYLE, scale: 'css' });
  const halo = await page.screenshot({ animations: 'disabled', style: PHOTO_HALO_STYLE, scale: 'css' });
  const [backgroundRegions, haloRegions] = await Promise.all([
    readScreenshotRegions(page, background, points), readScreenshotRegions(page, halo, points),
  ]);
  return points.map((point, index) => analyzeHaloRegion(backgroundRegions[index]!, haloRegions[index]!, point));
}

async function readPhotoControlContrast(page: Page, points: Awaited<ReturnType<typeof readForegrounds>>) {
  const background = await page.screenshot({ animations: 'disabled', style: REMOVE_GLYPHS, scale: 'css' });
  const painted = await page.screenshot({ animations: 'disabled', scale: 'css' });
  const [backgroundRegions, paintedRegions] = await Promise.all([
    readScreenshotRegions(page, background, points), readScreenshotRegions(page, painted, points),
  ]);
  return points.map((point, index) => ({ selector: point.selector, textLength: point.text.length,
    ...analyzePaintedPixels(backgroundRegions[index]!, paintedRegions[index]!, readabilityTarget(point)) }));
}

async function readRenderedBackgrounds(page: Page, points: Awaited<ReturnType<typeof readForegrounds>>) {
  const screenshot = await page.screenshot({ animations: 'disabled', style: REMOVE_GLYPHS, scale: 'css' });
  return page.evaluate(async ({ data, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取实际背景截图');
    context.drawImage(image, 0, 0);
    return points.map((point) => [...context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data].slice(0, 3));
  }, { data: screenshot.toString('base64'), points });
}

function luminance(rgb: readonly number[]) {
  const channels = rgb.map((value) => {
    const channel = value / COLOR_CHANNEL_MAX;
    return channel <= SRGB_LINEAR_THRESHOLD ? channel / SRGB_LINEAR_DIVISOR : ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
  });
  return channels.reduce((sum, channel, index) => sum + channel * LUMINANCE_WEIGHTS[index]!, 0);
}

export async function expectReadableHomepage(page: Page, targets: readonly ReadabilityTarget[] = HOMEPAGE_TARGETS) {
  const points = await readForegrounds(page, targets);
  const backgrounds = await readRenderedBackgrounds(page, points);
  for (const [index, point] of points.entries()) {
    const levels = [luminance(point.foreground), luminance(backgrounds[index]!)].toSorted((first, second) => first - second);
    const ratio = (levels[1]! + CONTRAST_OFFSET) / (levels[0]! + CONTRAST_OFFSET);
    const target = point.icon || point.size >= LARGE_TEXT_SIZE ? LARGE_TEXT_AND_ICON_CONTRAST : TEXT_CONTRAST;
    expect(ratio, `${point.selector}: ${ratio.toFixed(3)}:1，应至少 ${target}:1`).toBeGreaterThanOrEqual(target);
  }
}

function expectPhotoPixelContrast(
  points: Awaited<ReturnType<typeof readForegrounds>>,
  backgrounds: Awaited<ReturnType<typeof readRenderedBackgrounds>>,
  halo: Awaited<ReturnType<typeof readPhotoHaloContrast>>,
) {
  for (const [index, background] of backgrounds.entries()) {
    const point = points[index]!;
    expect(point.foreground).toEqual([255, 255, 255]);
    const levels = [luminance(point.foreground), luminance(background)].toSorted((first, second) => first - second);
    const ratio = (levels[1]! + CONTRAST_OFFSET) / (levels[0]! + CONTRAST_OFFSET);
    const target = point.size >= LARGE_TEXT_SIZE ? LARGE_TEXT_AND_ICON_CONTRAST : TEXT_CONTRAST;
    if (ratio < target) {
      const haloSample = halo[index]!;
      expect(haloSample.contrastingPixels,
        `${point.selector}: 底图 ${background.join(',')}，halo ${haloSample.contrastingPixels}/${haloSample.changedPixels} 像素达 ${target}:1, maxChange=${haloSample.maximumChange}`)
        .toBeGreaterThanOrEqual(
        Math.max(MINIMUM_HALO_PIXELS, Math.ceil(haloSample.textLength * HALO_PIXELS_PER_GLYPH)),
      );
      expect(haloSample.strongestContrast).toBeGreaterThanOrEqual(target);
    }
  }
}

async function readPhotoAppearance(page: Page) {
  return page.evaluate(() => {
    const clock = document.querySelector('time');
    const date = document.querySelector('time + p');
    const title = document.querySelector('section[aria-label="快捷方式"] a > span:last-child');
    const surface = document.querySelector('form[role="search"] .home-readable-surface');
    const input = document.querySelector('form[role="search"] input');
    if (!clock || !date || !title || !surface || !input) throw new Error('照片主页缺少文字或搜索表面');
    const foreground = getComputedStyle(document.documentElement).getPropertyValue('--home-readable-foreground').trim();
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, radius: style.borderRadius,
        shadow: style.textShadow, blur: style.backdropFilter };
    };
    return { foreground, clock: read(clock), date: read(date), title: read(title), surface: read(surface), input: read(input) };
  });
}

function expectPhotoTypography(appearance: Awaited<ReturnType<typeof readPhotoAppearance>>) {
  const isLight = appearance.foreground === '#000000';
  const foreground = isLight ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  const searchSurface = isLight ? 'rgba(250, 248, 245, 0.72)' : 'rgba(14, 16, 20, 0.58)';
  expect(appearance.foreground).toMatch(/^#(?:000000|ffffff)$/);
  for (const text of [appearance.clock, appearance.date, appearance.title]) {
    expect(text.color).toBe('rgb(255, 255, 255)');
    expect(text.background).toBe('rgba(0, 0, 0, 0)');
    expect(text.radius).toBe('0px');
    expect(text.shadow).not.toBe('none');
  }
  expect(appearance.surface.background).toBe(searchSurface);
  expect(appearance.surface.blur).toContain('blur(');
  expect(appearance.input.color).toBe(foreground);
}

export async function expectPhotoTreatment(page: Page) {
  const points = await readForegrounds(page, PHOTO_TEXT_TARGETS);
  const backgrounds = await readRenderedBackgrounds(page, points);
  const halo = await readPhotoHaloContrast(page, points);
  expectPhotoPixelContrast(points, backgrounds, halo);
  expectPhotoTypography(await readPhotoAppearance(page));
}

export async function expectPhotoControlContrast(page: Page) {
  const search = page.getByLabel('搜索', { exact: true });
  await search.fill('Search');
  await search.evaluate((input) => (input as HTMLInputElement).blur());
  const points = await readForegrounds(page, PHOTO_CONTROL_TARGETS);
  const contrast = await readPhotoControlContrast(page, points);
  for (const [index, point] of points.entries()) {
    const measured = contrast[index]!;
    const target = readabilityTarget(point);
    const minimumPixels = point.icon
      ? CONTROL_GLYPH_PIXEL_MIN
      : Math.max(MINIMUM_HALO_PIXELS, Math.ceil(point.text.length * CONTROL_PIXELS_PER_CHARACTER));
    expect(measured.contrastingPixels,
      `${point.selector}: 实际控件像素达到 ${target}:1 的数量 ${measured.contrastingPixels}/${measured.changedPixels}`)
      .toBeGreaterThanOrEqual(minimumPixels);
    expect(measured.strongestContrast).toBeGreaterThanOrEqual(target);
  }
}
