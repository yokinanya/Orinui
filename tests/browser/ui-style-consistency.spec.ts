import { expect, test } from '@playwright/test';

const WIDE_VIEWPORT = { width: 1440, height: 900 };
const RADIUS_TOLERANCE_PX = 1;

function radiusOf(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius));
}

test('删除网站后撤销入口出现在操作中心，可恢复网站', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByLabel('名称', { exact: true }).fill('撤销站点');
  await dialog.getByLabel('网址', { exact: true }).fill('undo.example.com');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden' });

  const link = page.getByRole('link', { name: '撤销站点', exact: true });
  await link.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(link).toHaveCount(0);

  const center = page.getByRole('region', { name: '操作状态' });
  await expect(center).toBeVisible();
  await expect(center).toContainText('已删除「撤销站点」');
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await center.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(link).toBeVisible();
});

test('设置面板内标题、提示与面板圆角保持同一层次', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '设置' });
  await expect(panel).toBeVisible();

  const panelRadius = await radiusOf(page, '[data-slot="dialog-content"]');
  for (const tab of ['外观', '布局', '搜索', '数据', '关于']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const tabpanel = page.getByRole('tabpanel', { name: tab, exact: true });
    await expect(tabpanel).toBeVisible();
    const oversizedNested = await tabpanel.evaluate((element) => {
      const panelValue = Number.parseFloat(getComputedStyle(element.closest('[data-slot="dialog-content"]')!).borderTopLeftRadius);
      return [...element.querySelectorAll('[data-slot="alert"], [data-slot="card"]')]
        .filter((node) => !node.closest('[data-slot="dialog-content"] [role="dialog"]'))
        .map((node) => Number.parseFloat(getComputedStyle(node).borderTopLeftRadius))
        .filter((radius) => radius >= panelValue);
    });
    expect(oversizedNested, `${tab} 面板内的提示/卡片圆角不应超过设置面板本身`).toEqual([]);
  }
  expect(panelRadius).toBeGreaterThan(0);
});

test('标题层级在同一面板内保持一致的强调程度', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  const styles = await layout.locator('h3, h4').evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return `${node.tagName}|${style.fontSize}|${style.fontWeight}`;
  }));
  expect(styles.length).toBeGreaterThan(0);
  const sectionHeadings = new Set(styles.filter((item) => item.startsWith('H3')).map((item) => item.split('|').slice(1).join('|')));
  const subHeadings = new Set(styles.filter((item) => item.startsWith('H4')).map((item) => item.split('|').slice(1).join('|')));
  // 布局页的二级设置标题可能在窄面板中省略；有该类标题时其强调程度才需比对分组标题。
  expect([...sectionHeadings]).toHaveLength(1);
  if (subHeadings.size === 0) return;
  // 次级标题不应比分组标题更重。
  const weight = (value: string) => Number(value.split('|')[1]);
  expect(weight([...subHeadings][0]!)).toBeLessThanOrEqual(weight([...sectionHeadings][0]!));
});
