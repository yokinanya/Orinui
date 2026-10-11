import { expect, test } from '@playwright/test';

const NARROW_VIEWPORT = { width: 320, height: 800 };
const MAX_DIALOG_TAB_STOPS = 12;

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置' });
}

test('320px 布局设置没有横向溢出且完整显示 24 小时选项', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const sheet = await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();

  const panel = page.getByRole('tabpanel', { name: '布局', exact: true });
  const dimensions = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const option = page.getByRole('button', { name: '24 小时', exact: true });
  await expect(option).toBeVisible();
  const [sheetBox, optionBox] = await Promise.all([sheet.boundingBox(), option.boundingBox()]);
  expect(sheetBox).not.toBeNull();
  expect(optionBox).not.toBeNull();
  expect(optionBox!.x).toBeGreaterThanOrEqual(sheetBox!.x);
  expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width);
});

test('320px 取色弹层完整位于设置抽屉内', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const sheet = await openSettings(page);
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '渐变', exact: true }).click();
  await page.getByRole('button', { name: /^起始颜色，当前 / }).click();

  const picker = page.locator('[data-slot="popover-content"]');
  await expect(picker).toBeVisible();
  const [sheetBox, pickerBox] = await Promise.all([sheet.boundingBox(), picker.boundingBox()]);
  expect(sheetBox).not.toBeNull();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.x).toBeGreaterThanOrEqual(sheetBox!.x);
  expect(pickerBox!.y).toBeGreaterThanOrEqual(sheetBox!.y);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width);
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height);
});

test('设置关闭按钮有中文名称，Escape 恢复焦点且网站保存可由 Tab 到达', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const sheet = await openSettings(page);
  const closeButton = sheet.locator('[data-slot="sheet-close"]');
  await expect(closeButton).toHaveAccessibleName('关闭');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();

  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveAccessibleName('关闭');
  await page.getByLabel('名称', { exact: true }).fill('键盘可达站点');
  await page.getByLabel('网址', { exact: true }).fill('keyboard.example.com');
  const save = dialog.getByRole('button', { name: '保存', exact: true });
  for (let index = 0; index < MAX_DIALOG_TAB_STOPS; index += 1) {
    if (await save.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(save).toBeFocused();
  await expect(save).toBeEnabled();
  const saveBox = await save.boundingBox();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.y).toBeGreaterThanOrEqual(0);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(NARROW_VIEWPORT.height);
});
