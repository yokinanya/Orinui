import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/newtab.html'); });

test('自定义搜索引擎可新增、设为默认并删除', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸与背景', exact: true }).click();
  await page.getByRole('button', { name: '新建壁纸', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await page.getByRole('button', { name: '管理搜索引擎', exact: true }).click();
  await page.getByRole('button', { name: '添加自定义引擎', exact: true }).click();
  await page.getByRole('region', { name: '搜索引擎管理' }).getByLabel('名称', { exact: true }).fill('Ecosia');
  await page.getByRole('region', { name: '搜索引擎管理' })
    .getByRole('textbox', { name: 'HTTPS 搜索模板', exact: true }).fill('https://www.ecosia.org/search?q={query}');
  await page.getByRole('button', { name: '添加搜索引擎' }).click();
  const ecosia = await expandEngine(page, 'Ecosia');
  await expect(ecosia.getByRole('textbox', { name: 'Ecosia 名称', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await selectSettingsEngine(page, 'Ecosia');
  await page.getByRole('button', { name: '管理搜索引擎', exact: true }).click();
  const selectedEcosia = await expandEngine(page, 'Ecosia');
  await expect(selectedEcosia.getByRole('button', { name: '删除 Ecosia' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸与背景', exact: true }).click();
  await page.getByRole('button', { name: '新建壁纸', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await expect(page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button')).toContainText('Ecosia');
  await selectSettingsEngine(page, 'Google');
  await page.getByRole('button', { name: '管理搜索引擎', exact: true }).click();
  const editableEcosia = await expandEngine(page, 'Ecosia');
  await editableEcosia.getByRole('button', { name: '删除 Ecosia' }).click();
  await expect(page.getByRole('button', { name: 'Ecosia 搜索引擎设置' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button').click();
  await expect(page.getByRole('menuitemradio', { name: 'Ecosia', exact: true })).toHaveCount(0);
});

async function selectSettingsEngine(page: import('@playwright/test').Page, name: string) {
  const picker = page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button');
  await picker.click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(picker).toContainText(name);
}

async function openManagement(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: '管理搜索引擎', exact: true }).click();
}

async function expandEngine(page: Page, name: string) {
  await page.getByRole('button', { name: `${name} 搜索引擎设置`, exact: true }).click();
  return page.getByRole('region', { name: `${name} 搜索设置`, exact: true });
}

test('引擎管理以紧凑列表显示，并说明关键词用途', async ({ page }) => {
  await openManagement(page);
  await expect(page.getByText(/输入“g React”会用 Google 搜索 React，不会更改默认引擎/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Google 搜索引擎设置' })).toContainText('预置');
  await expect(page.getByRole('button', { name: 'Google 搜索引擎设置' })).toContainText('默认');
  await expect(page.getByRole('region', { name: 'Google 搜索设置' })).toHaveCount(0);
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(3);
});

test('可编辑预置引擎并恢复预置设置', async ({ page }) => {
  await openManagement(page);
  const google = await expandEngine(page, 'Google');
  await google.getByRole('textbox', { name: 'Google 名称' }).fill('Google 中文');
  await google.getByRole('textbox', { name: 'Google HTTPS 搜索模板' }).fill('https://search.example/?q={query}');
  await google.getByRole('button', { name: '保存搜索引擎', exact: true }).click();
  const edited = page.getByRole('region', { name: 'Google 中文 搜索设置', exact: true });
  await edited.getByRole('textbox', { name: 'Google 中文 快捷词' }).fill('web');
  await edited.getByRole('button', { name: '保存快捷词', exact: true }).click();
  await expect(edited.getByRole('status', { name: 'Google 中文关键词保存状态' })).toHaveText('已保存');
  await page.reload();
  await openManagement(page);
  const persisted = await expandEngine(page, 'Google 中文');
  await expect(persisted.getByRole('textbox', { name: 'Google 中文 HTTPS 搜索模板' }))
    .toHaveValue('https://search.example/?q={query}');
  await expect(persisted.getByRole('textbox', { name: 'Google 中文 快捷词' })).toHaveValue('web');
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.route('https://search.example/**', (route) => route.fulfill({ status: 200, body: 'navigation fixture' }));
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('web 中文 a&b');
  await expect(page.getByRole('option')).toContainText('用 Google 中文 搜索');
  await input.press('Enter');
  await expect(page).toHaveURL('https://search.example/?q=中文%20a%26b');
  await page.goto('/newtab.html');
  await openManagement(page);
  const editableGoogle = await expandEngine(page, 'Google 中文');
  await editableGoogle.getByRole('button', { name: '恢复预置设置' }).click();
  const restored = page.getByRole('region', { name: 'Google 搜索设置', exact: true });
  await expect(restored.getByRole('textbox', { name: 'Google HTTPS 搜索模板' }))
    .toHaveValue('https://www.google.com/search?q={query}');
  await expect(restored.getByRole('textbox', { name: 'Google 快捷词' })).toHaveValue('web');
});

test('编辑引擎名称、模板和关键词后重载保留，并正确编码本次查询', async ({ page }) => {
  await openManagement(page);
  await page.getByRole('button', { name: '添加自定义引擎', exact: true }).click();
  await page.getByRole('region', { name: '搜索引擎管理' }).getByLabel('名称', { exact: true }).fill('Docs');
  await page.getByRole('region', { name: '搜索引擎管理' })
    .getByRole('textbox', { name: 'HTTPS 搜索模板', exact: true }).fill('https://example.test/?q={query}');
  await page.getByRole('button', { name: '添加搜索引擎', exact: true }).click();
  const row = await expandEngine(page, 'Docs');
  await row.getByRole('textbox', { name: 'Docs 名称' }).fill('Docs Plus');
  await row.getByRole('textbox', { name: 'Docs HTTPS 搜索模板' }).fill('https://example.test/?q={query}&from=orinui');
  await row.getByRole('button', { name: '保存搜索引擎', exact: true }).click();
  const updated = page.getByRole('region', { name: 'Docs Plus 搜索设置', exact: true });
  await updated.getByRole('textbox', { name: 'Docs Plus 快捷词' }).fill('docs');
  await updated.getByRole('button', { name: '保存快捷词', exact: true }).click();
  await expect(updated.getByRole('status', { name: 'Docs Plus关键词保存状态' })).toHaveText('已保存');
  await page.reload();
  await openManagement(page);
  const persisted = await expandEngine(page, 'Docs Plus');
  await expect(persisted.getByRole('textbox', { name: 'Docs Plus HTTPS 搜索模板' }))
    .toHaveValue('https://example.test/?q={query}&from=orinui');
  await expect(persisted.getByRole('textbox', { name: 'Docs Plus 快捷词' })).toHaveValue('docs');
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.route('https://example.test/**', (route) => route.fulfill({ status: 200, body: 'navigation fixture' }));
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('docs a&b');
  await expect(page.getByRole('option')).toContainText('用 Docs Plus 搜索');
  await input.press('Enter');
  await expect(page).toHaveURL('https://example.test/?q=a%26b&from=orinui');
});

