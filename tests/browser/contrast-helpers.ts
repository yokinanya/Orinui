import { expect, type Page } from '@playwright/test';
import { createDefaultSettings } from '@/domain/settings';
import { BACKUP_VERSION } from '@/domain/backup';
import { createZipFixture } from './zip-fixtures';

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

/** 用真实导入界面写入展示数据。 */
export async function importShortcutFixture(page: Page, fixture: Record<string, unknown> & { shortcuts: readonly object[] }): Promise<void> {
  // 备份校验要求字段完全一致；未指定的字段按新建网站的默认值补齐，字段顺序与导出保持一致。
  const manifest = {
    formatVersion: fixture.formatVersion,
    exportedAt: fixture.exportedAt,
    folders: fixture.folders,
    shortcuts: fixture.shortcuts.map((shortcut) => ({
      iconSourceUrl: null, icon: { kind: 'letter' }, ...shortcut,
    })),
    settings: fixture.settings,
    assets: fixture.assets,
  };
  await page.getByLabel('选择本地 ZIP 备份文件').setInputFiles({
    name: 'fixture.zip', mimeType: 'application/zip', buffer: createZipFixture(manifest),
  });
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
}

function fixture(input: BackgroundCase) {
  const defaults = createDefaultSettings();
  return {
    formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), assets: [],
    folders: [{ id: 'contrast-folder', name: '常用', order: 0 }],
    shortcuts: [{ id: 'contrast-site', folderId: null, title: '对比度站点', url: 'https://example.com/',
      icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
    settings: { ...defaults, appearance: { ...defaults.appearance, theme: input.theme, background: input.background,
      dynamicColor: { ...defaults.appearance.dynamicColor, enabled: input.dynamic } } },
  };
}

export async function configureBackground(page: Page, input: BackgroundCase) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据', exact: true }).click();
  await page.getByLabel('选择本地 ZIP 备份文件').setInputFiles({
    name: 'contrast.zip', mimeType: 'application/zip', buffer: createZipFixture(fixture(input)),
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
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
  await page.getByRole('button', { name: '照片', exact: true }).click();
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
