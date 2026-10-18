import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置' });
}

async function chooseLayoutOption(page: Page, option: string) {
  await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  await page.getByRole('tabpanel', { name: '布局', exact: true })
    .getByRole('button', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
}

async function setInitialPreferences(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  const input = page.getByRole('textbox', { name: '搜索' });
  await expect(input).not.toBeFocused();
  const settings = await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  await expect(layout.getByRole('heading', { name: '页面' })).toBeVisible();
  await expect(layout.getByRole('heading', { name: '时钟' })).toBeVisible();
  await expect(layout.getByRole('heading', { name: '网站' })).toBeVisible();
  await layout.getByRole('button', { name: '宽阔', exact: true }).click();
  await layout.getByRole('button', { name: '4 列', exact: true }).click();
  await layout.getByRole('button', { name: '英文缩写', exact: true }).click();
  await layout.getByRole('switch', { name: '显示秒数' }).click();
  const dateLine = page.locator('time').locator('..').locator('p');
  const englishWeekday = await page.evaluate(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()]);
  await layout.getByRole('switch', { name: '显示日期' }).click();
  await expect(dateLine).toHaveText(englishWeekday!);
  await layout.getByRole('switch', { name: '显示星期' }).click();
  await expect(dateLine).toHaveCount(0);
  await layout.getByRole('switch', { name: '显示日期' }).click();
  await expect(dateLine).toBeVisible();
  await layout.getByRole('switch', { name: '显示星期' }).click();
  await layout.getByRole('switch', { name: '显示网站名称' }).click();
  await layout.getByRole('button', { name: '新标签页', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  const search = page.getByRole('tabpanel', { name: '搜索', exact: true });
  await search.getByRole('button', { name: '窄', exact: true }).click();
  await search.getByRole('switch', { name: '打开主页时聚焦搜索' }).click();
  const openInNewTab = search.getByRole('button', { name: '新标签页', exact: true });
  await openInNewTab.click();
  await expect(openInNewTab).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(input).not.toBeFocused();
}

async function addShortcut(page: Page) {
  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站' });
  await dialog.getByLabel('名称', { exact: true }).fill('私人网站');
  await dialog.getByLabel('网址', { exact: true }).fill('example.com');
  await dialog.locator('button[type="submit"]').click();
}

async function expectGridWidths(page: Page) {
  // 网格与时钟、搜索共用页面宽度（此处为“宽阔” 1024px），格子随列数在该宽度内均分。
  const grid = page.locator('.shortcut-grid');
  const pageWidth = 1024;
  const columnWidth = (columns: number) => Math.round((pageWidth - (columns - 1) * 16) / columns);
  const tileWidth = async () => page.locator('.shortcut-grid li').first()
    .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  await expect.poll(() => grid.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(pageWidth);
  await chooseLayoutOption(page, '6 列');
  await expect.poll(tileWidth).toBe(columnWidth(6));
  await chooseLayoutOption(page, '8 列');
  await expect.poll(tileWidth).toBe(columnWidth(8));
  await expect.poll(tileWidth).toBeGreaterThanOrEqual(96);
}

async function expectShortcutKeyboardNavigation(page: Page) {
  await page.context().route('https://example.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<title>网站链接测试</title>',
  }));
  const newPage = page.context().waitForEvent('page');
  await page.getByRole('link', { name: '私人网站', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(await newPage).toHaveURL('https://example.com/');
  await expect(page).toHaveURL(/newtab\.html/);
}

test('布局、时钟与网站个性化可保存，英文星期和聚焦行为正确', async ({ page }) => {
  await setInitialPreferences(page);
  const englishWeekday = await page.evaluate(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()]);
  await expect(page.locator('time').locator('..').locator('p')).toContainText(englishWeekday!);
  await addShortcut(page);
  const shortcut = page.getByRole('link', { name: '私人网站', exact: true });
  await expect(shortcut).toHaveAttribute('title', '私人网站');
  await expect(shortcut).toHaveAttribute('target', '_blank');
  await expect(shortcut).toHaveAttribute('rel', /noopener noreferrer/);
  await expect(shortcut.getByText('私人网站', { exact: true })).toHaveClass(/sr-only/);
  await expectGridWidths(page);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索' })).toBeFocused();
  await expectShortcutKeyboardNavigation(page);
});

test('搜索设置为新标签页时保留主页并用键盘提交', async ({ page }) => {
  await page.goto('/newtab.html');
  await openSettings(page);
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  const openInNewTab = page.getByRole('tabpanel', { name: '搜索', exact: true })
    .getByRole('button', { name: '新标签页', exact: true });
  await openInNewTab.click();
  await expect(openInNewTab).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.context().route('https://www.google.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<title>搜索结果测试</title>',
  }));
  const resultPage = page.context().waitForEvent('page');
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('hello world');
  await input.press('Enter');
  await expect(await resultPage).toHaveURL(/google\.com\/search\?q=hello%20world/);
  await expect(page).toHaveURL(/newtab\.html/);
});

test('320px 空间不足时自动减少列数，不产生网格横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await addShortcut(page);
  await chooseLayoutOption(page, '8 列');
  const grid = page.locator('.shortcut-grid');
  await expect.poll(() => grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBeLessThan(8);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: '私人网站', exact: true })).toBeVisible();
});

test('主页区域支持手柄拖拽与键盘排序，显隐和原有移动按钮独立工作', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  const rows = layout.locator('ol > li');
  await expect(rows).toContainText(['时钟', '搜索', '快捷方式']);
  const handle = layout.getByRole('button', { name: '拖动时钟排序' });
  const target = rows.nth(2);
  await rows.first().scrollIntoViewIfNeeded();
  const [from, to] = await Promise.all([handle.boundingBox(), target.boundingBox()]);
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(rows).toContainText(['搜索', '快捷方式', '时钟']);
  await layout.getByRole('button', { name: '拖动时钟排序' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows).toContainText(['搜索', '时钟', '快捷方式']);
  await layout.getByRole('switch', { name: '显示时钟' }).click();
  await expect(layout.getByRole('switch', { name: '显示时钟' })).not.toBeChecked();
  await expect(rows).toContainText(['搜索', '时钟', '快捷方式']);
  await layout.getByRole('button', { name: '上移时钟' }).click();
  await expect(rows).toContainText(['时钟', '搜索', '快捷方式']);
  await expect.poll(() => layout.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '布局', exact: true }).getByRole('switch', { name: '显示时钟' })).not.toBeChecked();
});
