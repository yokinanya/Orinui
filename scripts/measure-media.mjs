import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const SAMPLE_INTERVAL_MS = 500;
const MEDIA_PATH = resolve(process.argv[2] ?? '.output/media-performance/loop-1080p.mp4');
const REPORT_PATH = resolve('.output/media-performance/result.json');
const ARCHIVE_PATH = resolve('.output/media-performance/backup.zip');
const BASE_URL = process.env.ORINUI_PREVIEW_URL ?? 'http://127.0.0.1:5173/newtab.html';

async function memorySample(input) {
  const metrics = await input.pageSession.send('Performance.getMetrics');
  const processes = await input.browserSession.send('SystemInfo.getProcessInfo');
  const ids = processes.processInfo.map(({ id }) => Number(id));
  if (!ids.every(Number.isSafeInteger)) throw new Error('浏览器进程 ID 无效');
  const command = `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`;
  const rss = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim());
  if (!Number.isFinite(rss) || rss <= 0) throw new Error('无法读取测试浏览器工作集');
  const heap = metrics.metrics.find(({ name }) => name === 'JSHeapUsedSize');
  if (!heap) throw new Error('浏览器未返回 JS 堆指标');
  return { jsHeapBytes: heap.value, browserWorkingSetBytes: rss };
}

async function measure(input, operation) {
  const samples = [await memorySample(input)];
  const started = performance.now();
  let complete = false;
  let samplingError = null;
  const task = operation().finally(() => { complete = true; });
  const sampling = (async () => {
    while (!complete) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, SAMPLE_INTERVAL_MS));
      if (!complete) samples.push(await memorySample(input));
    }
  })().catch((error) => { samplingError = error; });
  await task;
  const durationMs = performance.now() - started;
  await sampling;
  if (samplingError) throw samplingError;
  samples.push(await memorySample(input));
  return { durationMs, samples: samples.length,
    observedJsHeapPeakBytes: Math.max(...samples.map(({ jsHeapBytes }) => jsHeapBytes)),
    observedBrowserWorkingSetPeakBytes: Math.max(...samples.map(({ browserWorkingSetBytes }) => browserWorkingSetBytes)) };
}

async function upload(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '动态壁纸', exact: true }).click();
  await page.getByLabel('上传动态壁纸', { exact: true }).setInputFiles(MEDIA_PATH);
  await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible();
}

async function exportBackup(page) {
  await page.getByRole('tab', { name: '数据', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ZIP', exact: true }).click();
  const download = await pending;
  await download.saveAs(ARCHIVE_PATH);
  await stat(ARCHIVE_PATH);
  return ARCHIVE_PATH;
}

async function restoreBackup(page, path) {
  await page.getByLabel('选择本地 ZIP 备份文件').setInputFiles(path);
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageSession = await context.newCDPSession(page);
    const browserSession = await browser.newBrowserCDPSession();
    await pageSession.send('Performance.enable');
    const started = performance.now();
    await page.goto(BASE_URL);
    await expect(page.getByRole('button', { name: '添加第一个网站' })).toBeVisible();
    const initialReadyMs = performance.now() - started;
    const input = { pageSession, browserSession };
    const importMedia = await measure(input, () => upload(page));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
    await expect.poll(() => page.locator('video').evaluate((video) => !video.paused)).toBe(true);
    const reload = await measure(input, async () => {
      await page.reload();
      await expect.poll(() => page.locator('video').evaluate((video) => !video.paused)).toBe(true);
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    let archivePath;
    const exportZip = await measure(input, async () => { archivePath = await exportBackup(page); });
    const restoreZip = await measure(input, () => restoreBackup(page, archivePath));
    const report = { environment: 'isolated Chrome ordinary web preview', browser: browser.version(),
      mediaBytes: (await stat(MEDIA_PATH)).size, zipBytes: (await stat(archivePath)).size,
      initialReadyMs, importMedia, reload, exportZip, restoreZip,
      memoryScope: '500 ms requested samples plus endpoints; process sampling adds overhead; observed peaks include browser processes, not a guarantee of maximum memory',
      zipSignature: [...(await readFile(archivePath)).subarray(0, 4)] };
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}

await main();
