import { expect, type Page } from '@playwright/test';

export interface BackgroundCase {
  readonly name: string;
  readonly theme: 'light' | 'dark';
  readonly background: { readonly kind: 'solid'; readonly color: string }
    | { readonly kind: 'gradient'; readonly from: string; readonly to: string; readonly angle: number }
    | { readonly kind: 'default' };
  readonly dynamic: boolean;
}

const PHOTO_MASK_LARGE_STEP = 10;

export async function setPhotoMask(page: Page, percent: number) {
  const slider = page.getByRole('slider', { name: '照片遮罩强度（%）' });
  await slider.press('Home');
  const largeSteps = Math.floor(percent / PHOTO_MASK_LARGE_STEP);
  for (let step = 0; step < largeSteps; step += 1) await slider.press('PageUp');
  for (let step = largeSteps * PHOTO_MASK_LARGE_STEP; step < percent; step += 1) await slider.press('ArrowRight');
  await expect(page.getByLabel('当前照片遮罩强度')).toHaveText(`${percent}%`);
}

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
  await page.getByLabel('选择本地备份 JSON 文件').setInputFiles({
    name: 'contrast.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(input))),
  });
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
  await expect(page.getByRole('link', { name: '对比度站点', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
}

export async function uploadContrastPhoto(page: Page, input: { readonly color: 'black' | 'white'; readonly mask: number }) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '图片', exact: true }).click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="${input.color}"/></svg>`;
  await page.getByLabel('上传照片').setInputFiles({ name: 'contrast.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  const mask = page.getByRole('slider', { name: '照片遮罩强度（%）' });
  await expect(page.getByLabel('当前照片遮罩强度')).toHaveText('55%');
  await setPhotoMask(page, input.mask);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  await expect(page.getByLabel('当前照片遮罩强度')).toHaveText(`${input.mask}%`);
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
