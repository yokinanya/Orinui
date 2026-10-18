import { expect, test } from '@playwright/test';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 375, height: 812 }];

test('设置状态延后显示，实际外观先立即生效', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const status = page.getByRole('status', { name: '最近的操作状态' });
  await expect(status).toHaveCount(0);
  await page.clock.runFor(299);
  await expect(status).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(status).toContainText('保存外观设置');
  await page.clock.resume();
});

for (const viewport of VIEWPORTS) {
  test(`设置分区与面板内返回入口 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/newtab.html');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings.getByRole('region', { name: '主题模式' })).toBeVisible();
    await expect(settings.getByRole('button', { name: '浅色', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: '深色', exact: true }).click();
    await expect(settings.getByRole('button', { name: '深色', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const status = settings.getByRole('status', { name: '最近的操作状态' });
    await expect(status).toContainText('保存外观设置');
    const statusBounds = await status.boundingBox();
    const closeBounds = await settings.getByRole('button', { name: '关闭', exact: true }).boundingBox();
    expect(statusBounds).not.toBeNull();
    expect(closeBounds).not.toBeNull();
    expect(statusBounds!.x + statusBounds!.width).toBeLessThan(closeBounds!.x);
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(settings.getByRole('button', { name: '图片', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: '壁纸与背景', exact: true }).click();
    await expect(settings.getByRole('button', { name: '返回外观', exact: true })).toBeFocused();
    await expect(settings.getByRole('button', { name: '图片', exact: true })).toHaveCount(0);
    await expect(settings.getByText('壁纸库', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: '新建壁纸', exact: true }).click();
    await expect(settings.getByRole('button', { name: '返回壁纸库', exact: true })).toBeFocused();
    await expect(settings.getByRole('button', { name: '图片', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: '返回壁纸库', exact: true }).click();
    await expect(settings.getByRole('button', { name: '新建壁纸', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await settings.getByRole('button', { name: '返回外观', exact: true }).click();
    await expect(settings.getByRole('region', { name: '主题模式' })).toBeVisible();
    await expect(settings.getByRole('button', { name: '壁纸与背景', exact: true })).toBeFocused();
    await settings.getByRole('tab', { name: '搜索', exact: true }).click();
    await settings.getByRole('button', { name: '管理自定义搜索引擎', exact: true }).click();
    await expect(settings.getByRole('button', { name: '返回搜索', exact: true })).toBeFocused();
    await expect(settings.getByRole('region', { name: '自定义搜索引擎' })).toBeVisible();
    await settings.getByRole('button', { name: '返回搜索', exact: true }).click();
    await expect(settings.getByRole('region', { name: '搜索行为' })).toBeVisible();
    await expect(settings.getByRole('button', { name: '管理自定义搜索引擎', exact: true })).toBeFocused();
    const overflow = await settings.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
  });
}
