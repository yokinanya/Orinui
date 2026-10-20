import { expect, test } from '@playwright/test';

async function openSearchSettings(page: import('@playwright/test').Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
}

async function openEngineManagement(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '管理搜索引擎' }).click();
}

async function expandEngine(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: `${name} 搜索引擎设置`, exact: true }).click();
  return page.getByRole('region', { name: `${name} 搜索设置`, exact: true });
}

test('搜索设置按四个分区呈现并在重载后保留', async ({ page }) => {
  await openSearchSettings(page);
  const panel = page.getByRole('tabpanel', { name: '搜索', exact: true });
  for (const title of ['搜索框', '搜索行为', '结果内容', '搜索引擎']) {
    await expect(panel.getByRole('region', { name: title })).toBeVisible();
  }

  const wide = page.getByRole('button', { name: '宽', exact: true });
  await wide.click();
  await expect(wide).toHaveAttribute('aria-pressed', 'true');
  const pill = page.getByRole('button', { name: '胶囊', exact: true });
  await pill.click();
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '手动', exact: true }).click();
  const opacity = page.getByRole('slider', { name: '搜索框背景不透明度' });
  await opacity.focus();
  await page.keyboard.press('Home');
  await expect(opacity).toHaveAttribute('aria-valuenow', '0');
  const showSites = page.getByRole('switch', { name: '显示网站结果' });
  await showSites.click();
  await expect(showSites).not.toBeChecked();
  const showFolders = page.getByRole('switch', { name: '显示文件夹结果' });
  await showFolders.click();
  await expect(showFolders).not.toBeChecked();
  const github = page.getByRole('switch', { name: 'GitHub 命令' });
  await github.click();
  await expect(github).not.toBeChecked();
  await page.getByRole('textbox', { name: '提示文字' }).fill('本地搜索');
  await page.getByRole('textbox', { name: '提示文字' }).blur();
  const autoFocus = page.getByRole('switch', { name: '打开主页时聚焦搜索' });
  await autoFocus.click();
  await expect(autoFocus).toBeChecked();

  const enginePicker = panel.getByRole('group', { name: '默认搜索引擎' }).getByRole('button');
  await enginePicker.click();
  await page.getByRole('menuitemradio', { name: 'Bing' }).click();
  await expect(enginePicker).toContainText('Bing');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  const reloaded = page.getByRole('tabpanel', { name: '搜索', exact: true });
  await expect(reloaded.getByRole('button', { name: '宽', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reloaded.getByRole('button', { name: '胶囊', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reloaded.getByRole('slider', { name: '搜索框背景不透明度' })).toHaveAttribute('aria-valuenow', '0');
  await expect(reloaded.getByRole('switch', { name: '显示网站结果' })).not.toBeChecked();
  await expect(reloaded.getByRole('switch', { name: '显示文件夹结果' })).not.toBeChecked();
  await expect(reloaded.getByRole('switch', { name: 'GitHub 命令' })).not.toBeChecked();
  await expect(reloaded.getByRole('textbox', { name: '提示文字' })).toHaveValue('本地搜索');
  await expect(reloaded.getByRole('switch', { name: '打开主页时聚焦搜索' })).toBeChecked();
  await expect(reloaded.getByRole('group', { name: '默认搜索引擎' }).getByRole('button')).toContainText('Bing');
});

test('搜索框背景不透明度独立于文字透明度并支持自动恢复', async ({ page }) => {
  await openSearchSettings(page);
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await page.getByRole('button', { name: '胶囊', exact: true }).click();
  await expect(page.getByRole('button', { name: '胶囊', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '手动', exact: true }).click();
  const opacity = page.getByRole('slider', { name: '搜索框背景不透明度' });
  await opacity.focus();
  await page.keyboard.press('Home');
  await expect(opacity).toHaveAttribute('aria-valuenow', '0');
  const readAppearance = () => input.evaluate((element) => {
    const inputStyle = getComputedStyle(element);
    const groupStyle = getComputedStyle(element.parentElement!);
    const channels = groupStyle.backgroundColor.match(/[\d.]+/g) ?? [];
    return { backgroundAlpha: Number(channels[3] ?? 1), radius: groupStyle.borderRadius,
      textOpacity: Number(inputStyle.opacity), textColor: inputStyle.color };
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(async () => (await readAppearance()).backgroundAlpha).toBe(0);
  const transparent = await readAppearance();
  expect(transparent.backgroundAlpha).toBe(0);
  expect(transparent.radius).toBe('24px');
  expect(transparent.textOpacity).toBe(1);

  await openSearchSettings(page);
  await page.getByRole('button', { name: '手动', exact: true }).click();
  const fullOpacity = page.getByRole('slider', { name: '搜索框背景不透明度' });
  await fullOpacity.focus();
  await page.keyboard.press('End');
  await expect(fullOpacity).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(async () => (await readAppearance()).backgroundAlpha).toBe(1);
  const opaque = await readAppearance();
  expect(opaque.backgroundAlpha).toBe(1);
  expect(opaque.radius).toBe('24px');
  expect(opaque.textOpacity).toBe(1);
  expect(opaque.textColor).toBe(transparent.textColor);

  await openSearchSettings(page);
  await page.getByRole('button', { name: '自动', exact: true }).click();
  await expect(page.getByRole('slider', { name: '搜索框背景不透明度' })).toHaveCount(0);
  await page.reload();
  await openSearchSettings(page);
  await expect(page.getByRole('button', { name: '自动', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('引擎关键词拒绝快捷语法冲突和重复值', async ({ page }) => {
  await openSearchSettings(page);
  await openEngineManagement(page);
  const google = await expandEngine(page, 'Google');

  await google.getByRole('textbox', { name: 'Google 快捷词' }).fill('gh');
  await google.getByRole('button', { name: '保存快捷词' }).click();
  await expect(google.getByRole('alert')).toContainText('快捷工具语法冲突');

  await google.getByRole('textbox', { name: 'Google 快捷词' }).fill('g');
  await google.getByRole('button', { name: '保存快捷词' }).click();
  await expect(google.getByRole('status')).toHaveText('已保存');
  const bing = await expandEngine(page, 'Bing');
  await bing.getByRole('textbox', { name: 'Bing 快捷词' }).fill('g');
  await bing.getByRole('button', { name: '保存快捷词' }).click();
  await expect(bing.getByRole('alert')).toContainText('不能重复');
});

for (const width of [1440, 900, 360]) {
  test(`搜索设置在 ${width}px 视口不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openSearchSettings(page);
    const panel = page.getByRole('tabpanel', { name: '搜索', exact: true });
    const grid = panel.locator('.settings-columns');
    const dimensions = await grid.evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      overflow: element.scrollWidth > element.clientWidth,
    }));
    expect(dimensions.columns).toBe(width === 1440 ? 2 : 1);
    expect(dimensions.overflow).toBe(false);
    if (width === 1440) {
      const searchBox = await panel.getByRole('region', { name: '搜索框' }).boundingBox();
      const results = await panel.getByRole('region', { name: '结果内容' }).boundingBox();
      const behavior = await panel.getByRole('region', { name: '搜索行为' }).boundingBox();
      const engines = await panel.getByRole('region', { name: '搜索引擎' }).boundingBox();
      if (!searchBox || !results || !behavior || !engines) throw new Error('搜索设置卡片未生成布局边界');
      expect(Math.abs(results.y - searchBox.y - searchBox.height - 16)).toBeLessThan(1);
      expect(Math.abs(engines.y - behavior.y - behavior.height - 16)).toBeLessThan(1);
    }
    await openEngineManagement(page);
    const sections = panel.locator('.settings-section');
    const overflows = await sections.evaluateAll((elements) =>
      elements.map((element) => element.scrollWidth > element.clientWidth));
    expect(overflows.every((overflow) => !overflow)).toBe(true);
  });
}
