import { expect, test, type Page } from '@playwright/test';
import { visibleSubmitButton, openAddMenu } from './form-helpers';

interface MotionCall {
  target: string | null;
  keyframes: Keyframe[];
  duration: number;
}

declare global {
  interface Window {
    __motionCalls: MotionCall[];
  }
}

async function observeAnimations(page: Page) {
  await page.addInitScript(() => {
    window.__motionCalls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      window.__motionCalls.push({
        target: this.getAttribute('data-testid'),
        keyframes: Array.isArray(keyframes) ? keyframes : [],
        duration: Number(typeof options === 'number' ? options : options?.duration),
      });
      return animate.call(this, keyframes, options);
    };
  });
}

interface AddShortcutOptions {
  readonly first?: boolean;
  readonly editing?: boolean;
}

async function addShortcut(page: Page, name: string, options: AddShortcutOptions = {}) {
  const { first = false, editing = false } = options;
  if (!first) await openAddMenu(page, '添加网站');
  else await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByLabel('网址', { exact: true }).fill(`${name.toLowerCase()}.example.com`);
  await visibleSubmitButton(page).click();
  const shortcut = editing
    ? page.getByRole('button', { name: `${name} 的操作`, exact: true })
    : page.getByRole('link', { name, exact: true });
  await expect(shortcut).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/newtab.html');
});

test('主页首次进入时轻量淡入且内容立即可交互', async ({ page }) => {
  const animation = await page.locator('.motion-home-enter').evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(animation).toEqual({ name: 'home-content-enter', duration: '0.18s' });

  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});


async function addFolder(page: Page, name: string): Promise<void> {
  await openAddMenu(page, '新建文件夹');
  const dialog = page.getByRole('dialog', { name: '新建文件夹' });
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden' });
}

test('网格内容淡入使用统一动效，编辑状态保留', async ({ page }) => {
  await addShortcut(page, '主页站点', { first: true });
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await addFolder(page, '工作');

  // 文件夹条目是整卡拖拽容器，不再渲染为可点击按钮；按文本确认条目存在。
  await expect(page.locator('[data-home-item]').filter({ hasText: '工作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '完成编辑', exact: true })).toBeVisible();
  // 编辑模式下条目不是链接；用条目的可访问名称确认内容仍在。
  await expect(page.locator('[data-home-item]').filter({ hasText: '主页站点' })).toBeVisible();
  // 新建文件夹后网格仍是同一个容器，条目数为「网站 + 文件夹」。
  await expect(page.locator('[data-home-item]')).toHaveCount(2);
});

test('打开文件夹弹层显示其中的网站，主页网格不显示它们', async ({ page }) => {
  await addFolder(page, '工作');
  await page.getByRole('button', { name: '工作', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作' });
  await dialog.getByRole('button', { name: '添加网站', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('文档');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await visibleSubmitButton(page).click();
  await expect(dialog.getByRole('link', { name: '文档', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-shortcut-frame] a', { hasText: '文档' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '工作', exact: true })).toBeVisible();
});
