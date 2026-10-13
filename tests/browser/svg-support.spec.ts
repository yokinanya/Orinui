import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const SVG_FILE = new URL('../fixtures/x.svg', import.meta.url);
const ICON_COLOR = '#00cc55';
const ICON_TITLE = 'SVG备份站点';

async function uploadSvg(page: Page, source: string | Buffer) {
  await page.getByLabel('选择图标文件').setInputFiles({
    name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source),
  });
}

async function openIconForm(page: Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
}

test('SVG 静态展示属性可用，非法 XML 属性被明确拒绝并保留图标', async ({ page }) => {
  await openIconForm(page);
  await uploadSvg(page, '<svg xmlns="http://www.w3.org/2000/svg" xml:space="default" viewBox="0 0 40 40" color="#135792"><path d="M0 0h40v40H0Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" stroke="#123456" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>');
  const preview = page.getByRole('img', { name: '图标预览', exact: true });
  await expect(preview).toBeVisible();
  const original = await preview.getAttribute('src');
  await uploadSvg(page, '<svg xmlns="http://www.w3.org/2000/svg" xml:space="invalid" viewBox="0 0 40 40"><path d="M0 0h40v40H0Z"/></svg>');
  await expect(page.getByRole('alert')).toContainText('xml:space 只能是 default 或 preserve');
  await expect(preview).toHaveAttribute('src', original!);
  await uploadSvg(page, '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.com/" viewBox="0 0 40 40"><path d="M0 0h40v40H0Z"/></svg>');
  await expect(page.getByRole('alert')).toContainText('xml:base');
  await expect(preview).toHaveAttribute('src', original!);
});

test('SVG 矢量内容与单色设置可通过真实 JSON 文件备份并恢复', async ({ page }) => {
  await openIconForm(page);
  await page.getByLabel('名称', { exact: true }).fill(ICON_TITLE);
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await uploadSvg(page, await readFile(SVG_FILE));
  await page.getByRole('button', { name: /^SVG 图标颜色/ }).click();
  await page.getByLabel('十六进制颜色').fill(ICON_COLOR);
  await page.getByLabel('十六进制颜色').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const shortcut = page.getByRole('link', { name: ICON_TITLE, exact: true });
  await expect(shortcut.locator('[role="img"]')).toHaveCSS('background-color', 'rgb(0, 204, 85)');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: '导出 JSON' }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('SVG JSON 备份未落盘');
  const document = JSON.parse(await readFile(path, 'utf8'));
  expect(document.shortcuts[0].icon.color).toBe(ICON_COLOR);
  expect(document.assets[0].mime).toBe('image/svg+xml');
  expect(Buffer.from(document.assets[0].data, 'base64').toString()).toContain('xml:space="preserve"');
  await page.getByLabel('导入 JSON').setInputFiles(path);
  await page.getByRole('button', { name: '确认替换' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(shortcut.locator('[role="img"]')).toHaveCSS('background-color', 'rgb(0, 204, 85)');
  await page.reload();
  await expect(shortcut.locator('[role="img"]')).toHaveCSS('background-color', 'rgb(0, 204, 85)');
});
