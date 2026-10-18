import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { visibleSubmitButton } from './form-helpers';

declare global {
  interface Window {
    __svgDecodeGate?: { holdNext: boolean; release?: () => void };
  }
}

test('图标编辑以紧凑图标按钮选择上传并将图片URL操作收在输入框内', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();

  const upload = page.getByRole('button', { name: '上传图标', exact: true });
  await upload.click({ trial: true });
  const uploadBox = await upload.boundingBox();
  expect(uploadBox?.width).toBeGreaterThanOrEqual(32);
  expect(uploadBox?.width).toBeLessThan(48);
  await expect(upload.locator('svg')).toBeVisible();
  await expect(upload).toHaveText('');
  await expect(page.getByLabel('选择图标文件')).toBeHidden();

  const imageUrl = page.getByLabel('自定义图片URL', { exact: true });
  await expect(imageUrl).toBeVisible();
  const inputGroup = imageUrl.locator('xpath=..');
  await expect(inputGroup.locator('[data-slot="input-group-addon"][data-align="inline-end"]')).toBeVisible();
  await expect(inputGroup.locator('[data-slot="input-group-addon"] button')).toBeDisabled();
  await expect(page.getByText('图片和链接保存在本机及备份。', { exact: true })).toHaveCount(0);
});

test('图标选择显示真实预览，上传与首字母切换后保存正确', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('哔哩哔哩');
  await page.getByLabel('网址', { exact: true }).fill('https://www.bilibili.com');
  await expect(page.getByRole('img', { name: '名称首字母预览' })).toHaveText('哔');
  const picker = page.getByRole('button', { name: '选择内置图标' });
  await picker.click();
  const heart = page.getByRole('button', { name: '使用爱心图标' });
  await expect(heart.locator('svg')).toBeVisible();
  await heart.click();
  await expect(page.getByRole('img', { name: '内置图形预览' }).locator('svg')).toBeVisible();
  await picker.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const svg = await readFile(new URL('../fixtures/x.svg', import.meta.url));
  await page.getByLabel('选择图标文件').setInputFiles({
    name: 'icon.svg', mimeType: 'image/svg+xml',
    buffer: svg,
  });
  await expect(page.getByRole('img', { name: '图标预览', exact: true })).toHaveAttribute('src', /^blob:/);
  await picker.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '使用名称首字母' }).click();
  await expect(page.getByRole('img', { name: '名称首字母预览' })).toHaveText('哔');
  await expect(page.getByRole('img', { name: '图标预览', exact: true })).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: '添加网站', exact: true });
  await visibleSubmitButton(page).click();
  const shortcut = page.getByRole('link', { name: '哔哩哔哩', exact: true });
  await expect(dialog).toBeHidden();
  await expect(shortcut).toBeVisible();
  await expect(shortcut).toContainText('哔');
  await expect(shortcut.locator('img, svg')).toHaveCount(0);
  await page.reload();
  await expect(shortcut).toContainText('哔');
  await expect(shortcut.locator('img, svg')).toHaveCount(0);
});

test('安全 SVG 图标可着色、保存并恢复原色', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('SVG站点');
  await page.getByLabel('网址', { exact: true }).fill('svg.example.com');
  const svg = await readFile(new URL('../fixtures/x.svg', import.meta.url));
  await page.getByLabel('选择图标文件').setInputFiles({
    name: 'icon.svg', mimeType: 'image/svg+xml',
    buffer: svg,
  });
  await expect(page.getByRole('button', { name: /^SVG 图标颜色/ })).toBeVisible();
  await page.getByRole('button', { name: /^SVG 图标颜色/ }).click();
  const hex = page.getByLabel('十六进制颜色');
  await hex.fill('#c02020');
  await hex.press('Enter');
  const preview = page.getByRole('img', { name: '图标预览', exact: true });
  await expect(preview).toHaveCSS('background-color', 'rgb(192, 32, 32)');
  await visibleSubmitButton(page).click();
  const shortcut = page.getByRole('link', { name: 'SVG站点', exact: true });
  await expect(shortcut).toBeVisible();
  await expect(shortcut.locator('[role="img"]')).toHaveCSS('background-color', 'rgb(192, 32, 32)');
  await page.reload();
  await expect(shortcut.locator('[role="img"]')).toHaveCSS('background-color', 'rgb(192, 32, 32)');

  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  await page.getByRole('button', { name: 'SVG站点 的操作' }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: 'SVG 图标颜色，当前 #c02020' })).toBeVisible();
  await page.getByRole('button', { name: '恢复原色', exact: true }).click();
  await expect(page.getByRole('img', { name: '图标预览', exact: true })).toHaveAttribute('src', /^blob:/);
  await visibleSubmitButton(page).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(shortcut.locator('img')).toBeVisible();
  await expect(shortcut.locator('[role="img"]')).toHaveCount(0);

  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  await page.getByRole('button', { name: 'SVG站点 的操作' }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '选择内置图标' }).click();
  await page.getByRole('button', { name: '使用爱心图标' }).click();
  await expect(page.getByRole('button', { name: /^SVG 图标颜色/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('SVG 图片处理中颜色预览控件暂时禁用', async ({ page }) => {
  await page.addInitScript(() => {
    const gate = { holdNext: false, release: () => {} };
    Object.defineProperty(window, '__svgDecodeGate', { value: gate });
    const nativeDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (!gate.holdNext) return nativeDecode.call(this);
      gate.holdNext = false;
      return new Promise<void>((resolve, reject) => {
        gate.release = () => { void nativeDecode.call(this).then(resolve, reject); };
      });
    };
  });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('忙碌中的SVG');
  await page.getByLabel('网址', { exact: true }).fill('busy-svg.example.com');
  const svg = await readFile(new URL('../fixtures/x.svg', import.meta.url));
  await page.getByLabel('选择图标文件').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(page.getByRole('button', { name: /^SVG 图标颜色/ })).toBeVisible();
  await visibleSubmitButton(page).click();
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  await page.getByRole('button', { name: '忙碌中的SVG 的操作' }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const colorPicker = page.getByRole('button', { name: /^SVG 图标颜色/ });
  await page.evaluate(() => {
    const gate = window.__svgDecodeGate;
    if (!gate) throw new Error('SVG 解码门未初始化');
    gate.holdNext = true;
  });
  await page.getByLabel('选择图标文件').setInputFiles({ name: 'replacement.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(colorPicker).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const gate = window.__svgDecodeGate;
    return Boolean(gate && !gate.holdNext && typeof gate.release === 'function');
  })).toBe(true);
  await page.evaluate(() => {
    const gate = window.__svgDecodeGate;
    if (!gate?.release) throw new Error('SVG 解码门尚未就绪');
    gate.release();
  });
  await expect(colorPicker).toBeEnabled();
});

test('横屏输入与网站实时预览采用双列且保存可见，内置图标面板支持键盘返回', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站', exact: true });
  const livePreview = dialog.getByLabel('网站实时预览', { exact: true });
  await expect(livePreview).toBeVisible();
  await expect(dialog.getByRole('img', { name: '名称首字母预览' })).toBeVisible();
  await expect(visibleSubmitButton(page)).toBeInViewport();
  const [box, title, preview, save] = await Promise.all([
    dialog.boundingBox(), page.getByLabel('名称', { exact: true }).boundingBox(),
    livePreview.boundingBox(), visibleSubmitButton(page).boundingBox(),
  ]);
  if (!box || !title || !preview || !save) throw new Error('编辑表单未完整显示');
  expect(box.width).toBeGreaterThan(600);
  expect(title.x + title.width).toBeLessThan(preview.x);
  expect(save.y + save.height).toBeLessThanOrEqual(720);
  const picker = page.getByRole('button', { name: '选择内置图标' });
  await picker.focus();
  await page.keyboard.press('Enter');
  const choices = page.getByRole('group', { name: '内置图标', exact: true });
  await expect(choices.getByRole('button')).toHaveCount(6);
  expect(await choices.getByRole('button').allTextContents()).toEqual(['', '', '', '', '', '']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(picker).toBeFocused();
});

test('320px 图标上传错误保持可读且不造成横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  const svg = await readFile(new URL('../fixtures/x.svg', import.meta.url));
  await page.getByLabel('选择图标文件').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml', buffer: svg });
  const colorPicker = page.getByRole('button', { name: /^SVG 图标颜色/ });
  await expect(colorPicker).toBeVisible();
  await page.getByLabel('选择图标文件').setInputFiles({
    name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken'),
  });
  const error = page.locator('[data-slot="field-error"]');
  await expect(error).toBeVisible();
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    error: (() => {
      const element = document.querySelector('[data-slot="field-error"]')!;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    })(),
    colorPickerTop: document.querySelector<HTMLButtonElement>('#shortcut-svg-color')!.getBoundingClientRect().top,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.error.left).toBeGreaterThanOrEqual(0);
  expect(metrics.error.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.error.bottom).toBeLessThanOrEqual(metrics.colorPickerTop);
});
