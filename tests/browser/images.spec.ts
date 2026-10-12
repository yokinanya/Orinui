import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const svg = (content = '<rect width="40" height="20" fill="#37a1b2"/>') => ({
  name: 'image.svg', mimeType: 'image/svg+xml',
  buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">${content}</svg>`),
});

test.beforeEach(async ({ page }) => { await page.goto('/newtab.html'); });

async function rasterFile(page: Page, input: { readonly mime: string; readonly width: number; readonly height: number }) {
  const data = await page.evaluate(({ mime, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('缺少画布');
    context.fillStyle = '#37a1b2';
    context.fillRect(0, 0, width, height);
    const encoded = canvas.toDataURL(mime).split(',')[1];
    if (!encoded) throw new Error('画布编码未返回图片内容');
    return encoded;
  }, input);
  return { name: 'image', mimeType: input.mime, buffer: Buffer.from(data, 'base64') };
}

test('照片上传、动态色、遮罩与刷新持久化', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(svg());
  await expect(page.getByLabel('照片遮罩强度（%）')).toHaveValue('55');
  await page.getByLabel('照片遮罩强度（%）').fill('80');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper-mask'))).toContain('0.8');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'))).not.toBe('');
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('照片遮罩强度（%）')).toHaveValue('80');
});

test('危险 SVG 被明确拒绝，不修改现有照片', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(svg());
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  const previous = await page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'));
  await page.getByLabel('上传照片').setInputFiles(svg('<script>alert(1)</script>'));
  await expect(page.getByText('SVG 含不支持的元素，请改用 PNG/WebP')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toBe(previous);
});

test('图标草稿取消、保存、刷新、删除撤销', async ({ page }) => {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('图片站点');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByLabel('上传图标').setInputFiles(svg());
  await expect(page.getByRole('img', { name: '图标预览' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('link', { name: '图片站点' })).toHaveCount(0);
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('图片站点');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByLabel('上传图标').setInputFiles(svg());
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const link = page.getByRole('link', { name: '图片站点' });
  await expect(link.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.reload();
  await expect(link.locator('img')).toHaveAttribute('src', /^blob:/);
  await link.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(link.locator('img')).toHaveAttribute('src', /^blob:/);
});

for (const content of [
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
  '<rect width="40" height="20" onload="alert(1)"/>',
  '<image href="https://example.com/image.png"/>',
  '<style>rect { fill: url(https://example.com/image.svg); }</style>',
  '<rect width="40" height="20" fill="url(#pattern)"/>',
  '<animate attributeName="width" from="0" to="40" dur="1s"/>',
]) {
  test(`拒绝 SVG 危险或未支持内容：${content.slice(0, 30)}`, async ({ page }) => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('上传照片').setInputFiles(svg(content));
    await expect(page.getByText(/SVG (含不支持|不允许)/)).toBeVisible();
    await expect(page.getByLabel('照片遮罩强度（%）')).toHaveCount(0);
  });
}

for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
  test(`支持本地 ${mime} 照片，打开页面无外部请求`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { requests.push(request.url()); });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, { mime, width: 80, height: 40 }));
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:5173/') || url.startsWith('blob:'))).toBe(true);
  });
}

test('拒绝解码损坏文件与超过图标像素上限的图片', async ({ page }) => {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('上传图标').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.locator('[data-slot="field-error"]')).toBeVisible();
  await page.getByLabel('上传图标').setInputFiles(await rasterFile(page, { mime: 'image/png', width: 3000, height: 2000 }));
  await expect(page.getByText('图片像素不能超过 4 MP')).toBeVisible();
  await expect(page.getByRole('img', { name: '图标预览' })).toHaveCount(0);
});

test('自定义搜索引擎可新增、设为默认并删除', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await page.getByLabel('名称', { exact: true }).fill('Ecosia');
  await page.getByLabel('HTTPS 搜索模板').fill('https://www.ecosia.org/search?q={query}');
  await page.getByRole('button', { name: '添加搜索引擎' }).click();
  await expect(page.getByRole('button', { name: 'Ecosia', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ecosia', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除 Ecosia' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await expect(page.getByRole('button', { name: 'Ecosia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Google', exact: true }).click();
  await page.getByRole('button', { name: '删除 Ecosia' }).click();
  await expect(page.getByRole('button', { name: 'Ecosia', exact: true })).toHaveCount(0);
});

test('主页全部隐藏后可从主页一键恢复', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局' }).click();
  for (const slot of ['时钟', '搜索', '快捷方式']) {
    await page.getByRole('switch', { name: `显示${slot}` }).click();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '恢复主页内容' })).toBeVisible();
  await expect(page.locator('time')).toHaveCount(0);
  await expect(page.getByRole('search')).toHaveCount(0);
  await page.getByRole('button', { name: '恢复主页内容' }).click();
  await expect(page.locator('time')).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
});

test('时钟格式在设置和重新打开页面后保持', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局' }).click();
  await page.getByRole('button', { name: '24 小时', exact: true }).click();
  await expect(page.getByRole('button', { name: '24 小时', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局' }).click();
  await expect(page.getByRole('button', { name: '24 小时', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('JSON 可导出、预览导入并在确认后完整替换本地数据', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^orinui-.*\.json$/);
  const path = await download.path();
  if (!path) throw new Error('导出的 JSON 文件没有落盘');
  const content = JSON.parse(await readFile(path, 'utf8')) as { version: number; groups: unknown[]; settings: { clock: { format: string } } };
  expect(content).toMatchObject({ version: 1, groups: [{ name: '常用', isDefault: true }], settings: { clock: { format: 'system' } } });
  await page.getByRole('tab', { name: '布局' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('将被覆盖的网站');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('link', { name: '将被覆盖的网站' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据' }).click();
  await page.getByLabel('导入 JSON').setInputFiles(path);
  await expect(page.getByRole('alertdialog')).toContainText('备份包含 1 个分组、0 个网站、0 张图片');
  await page.getByRole('button', { name: '确认替换' }).click();
  await expect(page.getByRole('link', { name: '将被覆盖的网站' })).toHaveCount(0);
});

test('本地重置需要确认并恢复初始空组', async ({ page }) => {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('要删除的网站');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据' }).click();
  await page.getByRole('button', { name: '重置本地数据' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('永久删除本地数据');
  await page.getByRole('button', { name: '永久重置' }).click();
  await expect(page.getByRole('link', { name: '要删除的网站' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加第一个网站' })).toBeVisible();
});

test('新建网站可选择内置图形并保存在本地', async ({ page }) => {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('图形站点');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByRole('button', { name: '选择内置图标' }).click();
  await page.getByRole('button', { name: '使用爱心图标' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const link = page.getByRole('link', { name: '图形站点' });
  await expect(link.locator('svg')).toBeVisible();
  await page.reload();
  await expect(link.locator('svg')).toBeVisible();
});

test('分组颜色菜单写入对应语义角色', async ({ page }) => {
  await page.getByRole('button', { name: '编辑分组与网站' }).click();
  await page.getByRole('button', { name: '新建分组' }).click();
  await page.getByLabel('分组名称').fill('工作');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const group = page.getByRole('button', { name: '工作', exact: true });
  await group.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '标签颜色' }).click();
  await page.getByRole('menuitem', { name: '第三色' }).click();
  await expect(group).toHaveAttribute('data-color-role', 'tertiary');
  await page.reload();
  const restoredGroup = page.getByRole('button', { name: '工作', exact: true });
  await restoredGroup.click();
  await expect(restoredGroup).toHaveAttribute('data-color-role', 'tertiary');
});

test('带照片的 JSON 备份可恢复本地图片与外观设置', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(svg());
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  await page.getByLabel('照片遮罩强度（%）').fill('70');
  await page.getByRole('tab', { name: '数据' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: '导出 JSON' }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('带照片的备份没有落盘');
  const exported = JSON.parse(await readFile(path, 'utf8')) as { assets: Array<{ data: string; kind: string }>; settings: { appearance: { background: { kind: string; maskStrength: number } } } };
  expect(exported.assets).toHaveLength(1);
  expect(exported.assets[0]?.data).not.toBe('');
  expect(exported.settings.appearance.background).toMatchObject({ kind: 'photo', maskStrength: 0.7 });
  await page.getByLabel('导入 JSON').setInputFiles(path);
  await expect(page.getByRole('alertdialog')).toContainText('1 张图片');
  await page.getByRole('button', { name: '确认替换' }).click();
  await expect(page.getByRole('img')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('照片遮罩强度（%）')).toHaveValue('70');
});
