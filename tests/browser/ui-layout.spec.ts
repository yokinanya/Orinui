import { expect, test } from '@playwright/test';

const NARROW_VIEWPORT = { width: 320, height: 800 };
const MAX_DIALOG_TAB_STOPS = 12;

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置' });
}

async function openSettingsPanel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置' });
}

async function chooseLayoutOption(page: import('@playwright/test').Page, option: string) {
  await openSettingsPanel(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  await page.getByRole('tabpanel', { name: '布局', exact: true })
    .getByRole('button', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
}

test('主页搜索聚焦不显示底部线且不再显示分组导航', async ({ page }) => {
  await page.goto('/newtab.html');

  const search = page.getByRole('search');
  const input = search.getByRole('textbox', { name: '搜索' });
  await expect(input).toBeVisible();
  await input.focus();
  await expect(input).toBeFocused();
  const searchStyle = await search.locator('[data-slot="input-group"]').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle,
      image: style.backgroundImage,
    };
  });
  expect(searchStyle.outline).toBe('none');
  expect(searchStyle.image).toBe('none');

  await expect(page.getByRole('navigation', { name: '分组' })).toHaveCount(0);
});

test('320px 布局设置没有横向溢出且完整显示 24 小时选项', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const settingsPanel = await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();

  const panelContent = page.getByRole('tabpanel', { name: '布局', exact: true });
  const dimensions = await panelContent.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const option = page.getByRole('button', { name: '24 小时', exact: true });
  await expect(option).toBeVisible();
  const [panelBox, optionBox] = await Promise.all([settingsPanel.boundingBox(), option.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(optionBox).not.toBeNull();
  expect(optionBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
});

test('320px 取色弹层完整位于设置面板内', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const panel = await openSettings(page);
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '壁纸与背景', exact: true }).click();
  await page.getByRole('button', { name: '新建壁纸', exact: true }).click();
  await page.getByRole('button', { name: '渐变', exact: true }).click();
  await page.getByRole('button', { name: /^起始颜色，当前 / }).click();

  const picker = page.locator('[data-slot="popover-content"]');
  await expect(picker).toBeVisible();
  const [panelBox, pickerBox] = await Promise.all([panel.boundingBox(), picker.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(pickerBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
});

test('设置关闭按钮有中文名称，Escape 恢复焦点且网站保存可由 Tab 到达', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const panel = await openSettings(page);
  const closeButton = panel.locator('[data-slot="dialog-close"]');
  await expect(closeButton).toHaveAccessibleName('关闭');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();

  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveAccessibleName('关闭');
  await page.getByLabel('名称', { exact: true }).fill('键盘可达站点');
  await page.getByLabel('网址', { exact: true }).fill('keyboard.example.com');
  const save = dialog.locator('button[type="submit"]');
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
