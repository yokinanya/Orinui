import { expect, type Page } from '@playwright/test';

export interface BackgroundCase {
  readonly name: string;
  readonly theme: 'light' | 'dark';
  readonly background: { readonly kind: 'solid'; readonly color: string }
    | { readonly kind: 'gradient'; readonly from: string; readonly to: string; readonly angle: number }
    | { readonly kind: 'default' };
  readonly dynamic: boolean;
}

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
  { selector: 'nav[aria-label="分组"] button[aria-current="true"]' },
  { selector: 'button[aria-label="编辑分组与网站"]', icon: true },
  { selector: 'button[aria-label="设置"]', icon: true },
];
const COLOR_CHANNEL_MAX = 255;
const SRGB_LINEAR_THRESHOLD = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const CONTRAST_OFFSET = 0.05;
const REMOVE_GLYPHS = `time, time + p, section[aria-label="快捷方式"] a > span:last-child,
  main button, [data-slot="empty-title"], [data-slot="empty-description"],
  [data-slot="empty"] button, [data-testid="shortcut-group-content"] button span,
  button[aria-label="设置"] {
    color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important;
  }
  main svg, button[aria-label="设置"] svg { visibility: hidden !important; }`;

function fixture(input: BackgroundCase) {
  return {
    version: 1, exportedAt: new Date().toISOString(), assets: [],
    groups: [{ id: 'contrast-group', name: '常用', order: 0, isDefault: true, colorRole: 'primary' }],
    shortcuts: [{ id: 'contrast-site', groupId: 'contrast-group', title: '对比度站点', url: 'https://example.com/',
      icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
    settings: {
      appearance: { theme: input.theme, background: input.background,
        dynamicColor: { enabled: input.dynamic, mode: 'follow', seed: null } },
      search: { defaultEngineId: 'google', customEngines: [] },
      layout: { order: ['clock', 'search', 'shortcuts'], hidden: [] }, clock: { format: '24h' },
    },
  };
}

export async function configureBackground(page: Page, input: BackgroundCase) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据', exact: true }).click();
  await page.getByLabel('导入 JSON', { exact: true }).setInputFiles({
    name: 'contrast.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(input))),
  });
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
  await expect(page.getByRole('link', { name: '对比度站点', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
}

export async function uploadContrastPhoto(page: Page, input: { readonly color: 'black' | 'white'; readonly mask: number }) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="${input.color}"/></svg>`;
  await page.getByLabel('上传照片').setInputFiles({ name: 'contrast.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  const mask = page.getByLabel('照片遮罩强度（%）');
  await expect(mask).toHaveValue('55');
  await mask.fill(String(input.mask));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  await expect.poll(() => mask.inputValue()).toBe(String(input.mask));
  await expect.poll(() => page.evaluate(() => {
    const mask = document.documentElement.style.getPropertyValue('--wallpaper-mask');
    const alpha = mask.match(/[\d.]+/g)?.at(-1);
    if (!alpha) throw new Error('缺少照片遮罩透明度');
    return Number(alpha);
  })).toBe(input.mask / 100);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
  await page.mouse.move(0, 0);
}

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
      return { selector, foreground: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3),
        x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2,
        size: Number.parseFloat(style.fontSize), icon };
    });
  }, targets);
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
