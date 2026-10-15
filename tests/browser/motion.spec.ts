import { expect, test, type Page } from '@playwright/test';
import { visibleSubmitButton } from './form-helpers';

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
  await page.getByRole('button', { name: first ? '添加第一个网站' : '添加网站', exact: true }).click();
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

test('分组数据加载完成后才淡入新网站，且编辑状态保留', async ({ page }) => {
  await addShortcut(page, '常用站点', { first: true });
  await page.getByRole('button', { name: '编辑分组与网站' }).click();
  await page.getByRole('button', { name: '新建分组' }).click();
  await page.getByLabel('分组名称').fill('工作');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('button', { name: '工作', exact: true })).toBeVisible();
  await addShortcut(page, '工作站点', { editing: true });

  await page.getByRole('button', { name: '常用', exact: true }).click();
  await expect(page.getByText('常用站点', { exact: true })).toBeVisible();
  await expect(page.getByText('工作站点', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '工作', exact: true }).click();
  await expect(page.getByText('工作站点', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加网站', exact: true })).toBeVisible();

  const calls = await page.evaluate(() => window.__motionCalls);
  expect(calls.at(-1)).toMatchObject({ target: 'shortcut-group-content', duration: 180 });
  expect(calls.at(-1)?.keyframes[0]).toMatchObject({ opacity: 0, transform: 'translateY(5px)' });
});

test('减少动态效果时保留淡化反馈并取消空间位移', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  const animationName = await page.locator('.motion-home-enter').evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe('home-content-fade');

  await addShortcut(page, '常用站点', { first: true });
  await page.getByRole('button', { name: '编辑分组与网站' }).click();
  await page.getByRole('button', { name: '新建分组' }).click();
  await page.getByLabel('分组名称').fill('工作');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await addShortcut(page, '工作站点', { editing: true });
  await page.getByRole('button', { name: '常用', exact: true }).click();
  await expect(page.getByText('常用站点', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '工作', exact: true }).click();
  await expect(page.getByText('工作站点', { exact: true })).toBeVisible();

  const calls = await page.evaluate(() => window.__motionCalls);
  expect(calls.at(-1)).toMatchObject({ target: 'shortcut-group-content', duration: 150 });
  expect(calls.at(-1)?.keyframes[0]).toMatchObject({ opacity: 0 });
  expect(calls.at(-1)?.keyframes[0]).not.toHaveProperty('transform');
});

test('快速切组只显示最终分组，并正确显示空组', async ({ page }) => {
  await addShortcut(page, '常用站点', { first: true });
  await page.getByRole('button', { name: '编辑分组与网站' }).click();
  await page.getByRole('button', { name: '新建分组' }).click();
  await page.getByLabel('分组名称').fill('工作');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await addShortcut(page, '工作站点', { editing: true });
  await page.getByRole('button', { name: '新建分组' }).click();
  await page.getByLabel('分组名称').fill('空组');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑' }).click();
  await page.getByRole('button', { name: '工作', exact: true }).click();
  await expect(page.getByText('工作站点', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.__motionCalls = []; });

  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="分组"] button')];
    const select = (name: string) => {
      const tab = tabs.find((candidate) => candidate.textContent?.trim() === name);
      if (!tab) throw new Error(`缺少分组标签：${name}`);
      tab.click();
    };
    select('常用');
    select('空组');
  });

  await expect(page.getByText('还没有网站', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '工作站点', exact: true })).toHaveCount(0);
  await expect(page.getByText('正在读取分组网站…', { exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => window.__motionCalls);
  expect(calls).toHaveLength(1);
  expect(await page.getByTestId('shortcut-group-content').isVisible()).toBe(true);
});
