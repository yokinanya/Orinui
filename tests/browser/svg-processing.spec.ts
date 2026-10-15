import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { visibleSubmitButton } from './form-helpers';

const BILIBILI_FILE = new URL('../fixtures/bilibili-color.svg', import.meta.url);
const SVG_NS = 'http://www.w3.org/2000/svg';
const COMPLEX_SVG = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
<defs><linearGradient id="paint"><stop offset="0" style="stop-color:red"/><stop offset="1" stop-color="blue"/></linearGradient>
<clipPath id="cut"><circle cx="12" cy="12" r="10"/></clipPath><path id="shape" d="M0 0h24v24H0Z"/></defs>
<g style="fill:url(#paint);clip-path:url(#cut);opacity:0.8"><use xlink:href="#shape"/></g></svg>`;

async function upload(page: Page, source: string) {
  await page.getByLabel('选择图标文件').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
}

async function openForm(page: Page) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
}

async function readPreview(page: Page) {
  const preview = page.getByRole('img', { name: '图标预览', exact: true });
  await expect(preview).toBeVisible();
  return preview.evaluate(async (node) => {
    const image = node as HTMLImageElement;
    await image.decode();
    return { source: await (await fetch(image.src)).text(), width: image.naturalWidth, height: image.naturalHeight };
  });
}

test('用户的 bilibili SVG 支持根布局 style 和 em 尺寸，保存后刷新保留原色矢量', async ({ page }) => {
  await openForm(page);
  await upload(page, await readFile(BILIBILI_FILE, 'utf8'));
  const preview = await readPreview(page);
  expect(preview).toMatchObject({ width: 24, height: 24 });
  expect(preview.source).toContain('fill="#FB7299"');
  expect(preview.source).toContain('width="24"');
  await page.getByLabel('名称', { exact: true }).fill('哔哩哔哩SVG');
  await page.getByLabel('网址', { exact: true }).fill('https://www.bilibili.com');
  await visibleSubmitButton(page).click();
  await page.reload();
  const image = page.getByRole('link', { name: '哔哩哔哩SVG', exact: true }).locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate(async (node) => (await fetch((node as HTMLImageElement).src)).text())).toContain('fill="#FB7299"');
});

async function expectSamePixels(page: Page, original: string, normalized: string) {
  const pixels = await page.evaluate(async ({ original, normalized }) => {
    const render = async (source: string) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 24, 24);
        return Array.from(context.getImageData(0, 0, 24, 24).data);
      } finally { URL.revokeObjectURL(url); }
    };
    return { original: await render(original), normalized: await render(normalized) };
  }, { original, normalized });
  expect(pixels.normalized).toEqual(pixels.original);
  expect(pixels.normalized.some((value) => value > 0)).toBe(true);
}

test('内联 style、渐变、裁剪和 xlink 内部引用处理后像素与原始 SVG 一致', async ({ page }) => {
  await openForm(page);
  await upload(page, COMPLEX_SVG);
  const preview = await readPreview(page);
  expect(preview.source).toContain('fill="url(#paint)"');
  expect(preview.source).toContain('href="#shape"');
  expect(preview.source).not.toContain('style=');
  await expectSamePixels(page, COMPLEX_SVG, preview.source);
});

test('未知样式、外部引用、循环、重复和缺失 id 明确拒绝并保留当前图标', async ({ page }) => {
  await openForm(page);
  await upload(page, COMPLEX_SVG);
  await readPreview(page);
  const preview = page.getByRole('img', { name: '图标预览', exact: true });
  const original = await preview.getAttribute('src');
  const invalid = [
    '<path style="fill:url(https://example.com/a)"/>', '<path style="fill:var(--a)"/>',
    '<path style="fill:not-a-color"/>', '<path style="animation:spin 1s"/>',
    '<use href="#missing"/>', '<g id="a"><use href="#a"/></g>',
    '<path id="a"/><path id="a"/>', '<path id="a" fill="url(#a)"/>',
    '<script>alert(1)</script>', '<style>@import "https://example.com/x";</style>',
    '<style>path:hover{fill:red}</style>', '<style>@media screen {path{fill:red}}</style>',
    '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
  ];
  for (const content of invalid) {
    await upload(page, `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">${content}</svg>`);
    await expect(page.getByRole('alert')).toContainText('SVG');
    await expect(preview).toHaveAttribute('src', original!);
  }
  await upload(page, `<svg xmlns="${SVG_NS}" width="1em" height="1em"><path d="M0 0h1v1Z"/></svg>`);
  await expect(page.getByRole('alert')).toContainText('有效的尺寸或 viewBox');
  await expect(preview).toHaveAttribute('src', original!);
});

test('class、id、元素选择器及 important 的级联转换保留原始像素', async ({ page }) => {
  await openForm(page);
  const source = `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"><style>
rect{fill:blue}.shape{fill:green}rect.shape{fill:yellow}#icon{fill:red!important}.shape{fill:purple!important}
</style><rect id="icon" class="shape" width="24" height="24" fill="black" style="fill:cyan"/></svg>`;
  await upload(page, source);
  const preview = await readPreview(page);
  expect(preview.source).toContain('fill="red"');
  expect(preview.source).not.toContain('<style');
  expect(preview.source).not.toContain('style=');
  await expectSamePixels(page, source, preview.source);
  const image = page.getByRole('img', { name: '图标预览', exact: true });
  const previousUrl = await image.getAttribute('src');
  await upload(page, source.replace('fill:cyan', 'fill:cyan!important'));
  await expect(image).not.toHaveAttribute('src', previousUrl!);
  expect((await readPreview(page)).source).toContain('fill="cyan"');
});

const RESOURCE_CASES = [
  { name: '径向渐变', definition: '<radialGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>', attribute: 'fill="url(#paint)"' },
  { name: '蒙版', definition: '<mask id="paint"><rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="5" fill="black"/></mask>', attribute: 'mask="url(#paint)" fill="red"' },
  { name: '平铺图案', definition: '<pattern id="paint" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="red"/></pattern>', attribute: 'fill="url(#paint)"' },
];

for (const resource of RESOURCE_CASES) {
  test(`静态${resource.name}处理后像素一致`, async ({ page }) => {
    await openForm(page);
    const source = `<svg xmlns="${SVG_NS}" width="24" height="24" viewBox="0 0 24 24"><defs>${resource.definition}</defs><rect width="24" height="24" ${resource.attribute}/></svg>`;
    await upload(page, source);
    await expectSamePixels(page, source, (await readPreview(page)).source);
  });
}
