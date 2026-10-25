import { expect, test } from '@playwright/test';
import { configureBackground, uploadContrastPhoto, type BackgroundCase } from './contrast-helpers';
import { expectPhotoControlContrast, expectPhotoTreatment, expectReadableHomepage } from './contrast-measurement';

const BACKGROUND_CASES: readonly BackgroundCase[] = [
  { name: '浅色纯黑背景，动态色关闭', theme: 'light', background: { kind: 'solid', color: '#000000' }, dynamic: false },
  { name: '深色纯白背景，动态色关闭', theme: 'dark', background: { kind: 'solid', color: '#ffffff' }, dynamic: false },
  { name: '浅色纯黑背景，动态色开启', theme: 'light', background: { kind: 'solid', color: '#000000' }, dynamic: true },
  { name: '深色纯白背景，动态色开启', theme: 'dark', background: { kind: 'solid', color: '#ffffff' }, dynamic: true },
  { name: '黑到白强反差渐变', theme: 'light', background: { kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 }, dynamic: true },
  { name: '白到黑强反差渐变', theme: 'dark', background: { kind: 'gradient', from: '#ffffff', to: '#000000', angle: 90 }, dynamic: false },
];

for (const input of BACKGROUND_CASES) {
  test(`${input.name}：文字、文件夹与编辑/设置图标达到所需对比`, async ({ page }) => {
    await configureBackground(page, input);
    await expectReadableHomepage(page);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const color of ['black', 'white'] as const) {
    for (const mask of [0, 55, 100] as const) {
      test(`${theme} 主题 ${color} 照片遮罩 ${mask}%：采样真实字形与邻接 halo 对比`, async ({ page }) => {
        await configureBackground(page, { name: '照片对比', theme, background: { kind: 'default' }, dynamic: true });
        await uploadContrastPhoto(page, { color, mask });
        await expectPhotoTreatment(page);
      });
    }
  }
}

for (const color of ['black', 'white'] as const) {
  test(`动态配色关闭时，${color === 'black' ? '深色' : '浅色'}照片仍按封面色调整前景`, async ({ page }) => {
    await configureBackground(page, { name: '关闭动态配色的照片', theme: 'light', background: { kind: 'default' }, dynamic: false });
    await uploadContrastPhoto(page, { color, mask: 0 });
    await expectPhotoTreatment(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--home-readable-foreground')))
      .toBe(color === 'black' ? '#ffffff' : '#000000');
  });
}

test('无遮罩白照片：设置/编辑/站点图标达到3:1，搜索文字达到4.5:1', async ({ page }) => {
  await configureBackground(page, { name: '无遮罩照片控件对比', theme: 'light', background: { kind: 'default' }, dynamic: true });
  await uploadContrastPhoto(page, { color: 'white', mask: 0 });
  await expectPhotoControlContrast(page);
});

test('自定义暗背景下空主页标题、引导和添加操作可读', async ({ page }) => {
  await configureBackground(page, BACKGROUND_CASES[0]!);
  await page.getByRole('link', { name: '对比度站点', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '常用', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除文件夹', exact: true }).click();
  const emptyEntry = page.getByRole('button', { name: '添加第一个网站', exact: true });
  await expect(emptyEntry).toBeVisible();
  // 主页为空时只保留明确的添加入口，它必须能在暗背景上读出。
  await expectReadableHomepage(page, [{ selector: '[data-home-empty]' }]);
});

test('自定义暗背景下编辑模式的操作与添加入口可读', async ({ page }) => {
  await configureBackground(page, BACKGROUND_CASES[0]!);
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成编辑' })).toBeVisible();
  await expectReadableHomepage(page, [
    { selector: 'button[aria-label="完成编辑"]', icon: true },
    { selector: 'button[aria-label="添加"][aria-haspopup="menu"]', icon: true },
  ]);
});
