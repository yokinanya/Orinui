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
  // 双列网格宽度受页面宽度设置约束（此处为“宽阔” 1024px），两列等分且不溢出。
  const grid = page.locator('[data-home-grid]');
  const region = page.getByRole('region', { name: '快捷方式', exact: true });
  await expect.poll(() => region.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBeLessThanOrEqual(1024);
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '));
  expect(columns).toHaveLength(2);
  const itemWidth = await page.locator('[data-home-item]').first().evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(Number.parseFloat(columns[0]!) - itemWidth)).toBeLessThan(2);
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
  // 新双列网格中名称始终可见。
  await expect(shortcut.getByText('私人网站', { exact: true })).toBeVisible();
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

test('320px 视口保持双列且不产生横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await addShortcut(page);
  const grid = page.locator('[data-home-grid]');
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '));
  expect(columns).toHaveLength(2);
  await expect.poll(() => grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: '私人网站', exact: true })).toBeVisible();
});

test('布局设置保留区域显隐，并在刷新后生效', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  await layout.getByRole('switch', { name: '显示时钟' }).click();
  await expect(layout.getByRole('switch', { name: '显示时钟' })).not.toBeChecked();
  await expect.poll(() => layout.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('time')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('time')).toHaveCount(0);
  await expect(page.getByRole('search')).toBeVisible();
});
