import { expect, test } from '@playwright/test';

const NARROW_VIEWPORT = { width: 320, height: 800 };
const WIDE_VIEWPORT = { width: 1000, height: 800 };
const MAX_DIALOG_TAB_STOPS = 12;
const POINTER_DRAG_STEPS = 6;
const KEYBOARD_DRAG_STEPS = 1;
const SCROLLBAR_THICKNESS_TOLERANCE = 1;

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置' });
}

test('主页搜索聚焦只显示单线，当前分组用下划线区分', async ({ page }) => {
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
      imageSize: style.backgroundSize,
    };
  });
  expect(searchStyle.outline).toBe('none');
  expect(searchStyle.image).not.toBe('none');
  expect(searchStyle.imageSize).toContain('2px');

  const tab = page.getByRole('navigation', { name: '分组' }).getByRole('button', { name: '常用', exact: true });
  const tabStyle = await tab.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      shadow: style.boxShadow,
      bottomBorder: style.borderBottomWidth,
      marker: getComputedStyle(element, '::after').width,
      markerColor: getComputedStyle(element, '::after').backgroundColor,
    };
  });
  expect(tabStyle.background).toBe('rgba(0, 0, 0, 0)');
  expect(tabStyle.shadow).toBe('none');
  expect(tabStyle.bottomBorder).toBe('0px');
  expect(tabStyle.marker).toBe('16px');
  expect(tabStyle.markerColor).not.toBe('rgba(0, 0, 0, 0)');
});

async function createGroup(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建分组' });
  await dialog.getByLabel('分组名称').fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function measureScrollbarThickness(element: import('@playwright/test').Locator) {
  return element.evaluate((node) => {
    const container = node as HTMLElement;
    return container.offsetHeight - container.clientHeight;
  });
}

async function dragGroupWithMouse(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
) {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: POINTER_DRAG_STEPS });
}

async function dragGroupWithKeyboard(
  page: import('@playwright/test').Page,
  tab: import('@playwright/test').Locator,
  direction: 'ArrowLeft' | 'ArrowRight',
) {
  await tab.focus();
  await page.keyboard.press('Space');
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  const liveRegion = page.locator('[aria-live="assertive"]').first();
  const currentAnnouncement = await liveRegion.textContent();
  const activeId = currentAnnouncement?.match(/(?:Picked up draggable item |Draggable item )(.+?)(?:\.| was moved over)/)?.[1];
  if (!activeId) throw new Error('键盘拖动未公布已拿起的分组');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  for (let step = 0; step < KEYBOARD_DRAG_STEPS; step += 1) await page.keyboard.press(direction);
  await expect.poll(() => liveRegion.textContent())
    .not.toBe(`Draggable item ${activeId} was moved over droppable area ${activeId}.`);
  await page.keyboard.press('Space');
  await expect(tab).not.toHaveAttribute('aria-pressed', 'true');
}

async function openGroupMenuWithKeyboard(page: import('@playwright/test').Page, tab: import('@playwright/test').Locator) {
  await tab.focus();
  await page.keyboard.press('Shift+F10');
  const renameItem = page.getByRole('menuitem', { name: '重命名' });
  await expect(renameItem).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(renameItem).toHaveCount(0);
}

async function waitForGroupLayout(page: import('@playwright/test').Page) {
  await expect.poll(() => page.getByRole('navigation', { name: '分组' }).locator('li').evaluateAll((items) =>
    items.every((item) => item.getAnimations().every((animation) => animation.playState === 'finished')),
  )).toBe(true);
}

test('分组标签保持无外框与三点，溢出时隐藏滚动条且菜单键可用', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 800 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '编辑分组与网站', exact: true }).click();
  for (const name of ['工作', '阅读', '工具', '生活', '收藏', '临时']) await createGroup(page, name);

  const tabs = page.getByRole('navigation', { name: '分组' });
  const scroller = tabs.locator('.group-tabs-scroll');
  await expect(tabs.locator('.home-readable-group-shell')).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: /分组的操作/ })).toHaveCount(0);
  const overflow = await scroller.evaluate((element) => {
    const container = element as HTMLElement;
    return {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      clientHeight: container.clientHeight,
      offsetHeight: container.offsetHeight,
    };
  });
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  expect(overflow.offsetHeight - overflow.clientHeight).toBeLessThanOrEqual(SCROLLBAR_THICKNESS_TOLERANCE);

  const defaultTab = tabs.getByRole('button', { name: '常用', exact: true });
  const adjacentTab = tabs.getByRole('button', { name: '工作', exact: true });
  await dragGroupWithMouse(page, defaultTab, adjacentTab);
  expect(await measureScrollbarThickness(scroller)).toBeLessThanOrEqual(SCROLLBAR_THICKNESS_TOLERANCE);
  await page.mouse.up();
  await expect(tabs.getByRole('button').nth(0)).toHaveText('工作');
  await expect(tabs.getByRole('button').nth(1)).toHaveText('常用');
  await waitForGroupLayout(page);
  await scroller.evaluate((element) => {
    const container = element as HTMLElement;
    container.scrollTo({ left: container.scrollWidth });
  });
  await expect.poll(() => scroller.evaluate((element) => (element as HTMLElement).scrollLeft)).toBeGreaterThan(0);

  await scroller.evaluate((element) => ((element as HTMLElement).scrollLeft = 0));
  await page.setViewportSize(WIDE_VIEWPORT);
  const wideDimensions = await scroller.evaluate((element) => ({
    clientWidth: (element as HTMLElement).clientWidth,
    scrollWidth: (element as HTMLElement).scrollWidth,
  }));
  expect(wideDimensions.scrollWidth).toBeLessThanOrEqual(wideDimensions.clientWidth);
  await waitForGroupLayout(page);
  await dragGroupWithKeyboard(page, defaultTab, 'ArrowRight');
  await expect(tabs.getByRole('button').nth(1)).toHaveText('阅读');
  await expect(tabs.getByRole('button').nth(2)).toHaveText('常用');
  await waitForGroupLayout(page);
  await openGroupMenuWithKeyboard(page, defaultTab);
  await waitForGroupLayout(page);
  await dragGroupWithKeyboard(page, defaultTab, 'ArrowLeft');
  await expect(tabs.getByRole('button').nth(1)).toHaveText('常用');
});

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
