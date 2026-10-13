import { expect, test } from '@playwright/test';

const NARROW_VIEWPORT = { width: 320, height: 800 };

async function openDataPanel(page: import('@playwright/test').Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据', exact: true }).click();
}

test('WebDAV 设置表单标注字段并将应用密码遮蔽', async ({ page }) => {
  await openDataPanel(page);

  await expect(page.getByLabel('WebDAV 地址')).toBeVisible();
  await expect(page.getByLabel('账号')).toBeVisible();
  await expect(page.getByLabel('应用密码')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('恢复密钥（可选）')).toBeVisible();
  await expect(page.getByText(/专用文件夹/)).toBeVisible();
});

test('普通网页预览的 WebDAV 检查明确报告缺少扩展环境', async ({ page }) => {
  await openDataPanel(page);
  await page.getByLabel('WebDAV 地址').fill('https://example.invalid/webdav/orinui');
  await page.getByLabel('账号').fill('test-user');
  await page.getByLabel('应用密码').fill('test-password');
  await page.getByLabel('恢复密钥（可选）').fill('test-recovery-key');
  await page.getByRole('button', { name: '检查连接', exact: true }).click();

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toContainText(/Chrome 扩展|扩展环境/);
  await expect(page.getByLabel('应用密码')).toHaveValue('test-password');
  await expect(page.getByLabel('恢复密钥（可选）')).toHaveValue('test-recovery-key');
});

test('320px 数据页的 WebDAV 设置不产生横向溢出', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await openDataPanel(page);

  const panel = page.getByRole('tabpanel', { name: '数据', exact: true });
  const dimensions = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByLabel('WebDAV 地址')).toBeVisible();
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeVisible();
});
