import { chromium, expect } from '@playwright/test';

const CHROMIUM_EXECUTABLE = 'C:/Users/yokinanya/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const FIXTURE_USERNAME = 'orinui-audit';
const FIXTURE_PASSWORD = 'fixture-only-password';

export async function launchAuditProfile({ extensionPath, profilePath, downloadsPath, headed = false }) {
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: CHROMIUM_EXECUTABLE,
    channel: 'chromium',
    headless: !headed,
    viewport: { width: 1440, height: 960 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    acceptDownloads: true,
    downloadsPath,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      ...(headed ? ['--window-position=-32000,-32000'] : []),
    ],
  });
  const page = context.pages()[0] ?? await context.newPage();
  const errors = [];
  const networkRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  await page.goto('chrome://newtab');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible({ timeout: 30_000 });
  if (!page.url().startsWith('chrome-extension://')) throw new Error(`未进入扩展新标签页：${page.url()}`);
  return { context, page, errors, networkRequests };
}

export async function openSettingsTab(page, name) {
  if (await page.getByRole('heading', { name: '设置', exact: true }).count() === 0) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
  }
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

export async function assertBetaAbout(page, version) {
  await openSettingsTab(page, '关于');
  const panel = page.getByRole('tabpanel', { name: '关于', exact: true });
  await expect(panel).toContainText(`版本 ${version}`);
  return (await panel.innerText()).trim();
}

export async function createWebDavVault(page, url) {
  await openSettingsTab(page, '数据');
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.locator('#webdav-url').fill(url);
  await page.locator('#webdav-username').fill(FIXTURE_USERNAME);
  await page.locator('#webdav-password').fill(FIXTURE_PASSWORD);
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '首次合并预览' })).toBeVisible({ timeout: 30_000 });
  const keyInput = page.locator('#webdav-new-recovery-key');
  await expect(keyInput).toHaveValue(/.+/);
  const recoveryKey = await keyInput.inputValue();
  await page.getByRole('checkbox', { name: '我已保存恢复密钥', exact: true }).check();
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await waitForConnection(page);
  return recoveryKey;
}

export async function joinWebDavVault(page, url, recoveryKey) {
  await openSettingsTab(page, '数据');
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.locator('#webdav-url').fill(url);
  await page.locator('#webdav-username').fill(FIXTURE_USERNAME);
  await page.locator('#webdav-password').fill(FIXTURE_PASSWORD);
  await page.locator('#webdav-recovery-key').fill(recoveryKey);
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '首次合并预览' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await waitForConnection(page);
}

async function waitForConnection(page) {
  const panel = page.locator('section[aria-labelledby="webdav-connected-title"]');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const button = panel.getByRole('button', { name: /立即同步|处理中/ });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await manuallySync(page);
  await expect(panel.getByText('已同步', { exact: true })).toBeVisible({ timeout: 60_000 });
}

export async function uploadMotion({ page, filePath, mime, kind }) {
  await openSettingsTab(page, '外观');
  await page.getByRole('button', { name: '动态壁纸', exact: true }).click();
  await page.locator('#motion-upload').setInputFiles(filePath);
  await expect.poll(() => readMotionState(page), { timeout: 60_000 }).toMatchObject({
    background: { kind: 'motion' }, asset: { mime, motion: { kind, posterSize: expect.any(Number) } },
  });
  await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible({ timeout: 60_000 });
  const stored = await readMotionState(page);
  expect(stored.background.kind).toBe('motion');
  expect(stored.asset).toBeTruthy();
  expect(stored.asset.mime).toBe(mime);
  expect(stored.asset.motion.kind).toBe(kind);
  expect(stored.asset.motion.posterType).toMatch(/^image\/(png|jpeg|webp)$/);
  return stored;
}

export async function readMotionState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('orinui');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction(['settings', 'assets', 'sync_state'], 'readonly');
      const settingsRequest = transaction.objectStore('settings').get('app');
      const assetsRequest = transaction.objectStore('assets').getAll();
      const stateRequest = transaction.objectStore('sync_state').get('app');
      const [settings, assets, syncState] = await Promise.all([
        new Promise((resolve, reject) => { settingsRequest.onsuccess = () => resolve(settingsRequest.result); settingsRequest.onerror = () => reject(settingsRequest.error); }),
        new Promise((resolve, reject) => { assetsRequest.onsuccess = () => resolve(assetsRequest.result); assetsRequest.onerror = () => reject(assetsRequest.error); }),
        new Promise((resolve, reject) => { stateRequest.onsuccess = () => resolve(stateRequest.result); stateRequest.onerror = () => reject(stateRequest.error); }),
      ]);
      const background = settings?.appearance?.background;
      const asset = assets.find((candidate) => candidate.id === background?.assetId);
      return { background, asset: asset ? { id: asset.id, mime: asset.mime, size: asset.blob.size,
        motion: asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration,
          posterType: asset.motion.poster?.type ?? null, posterSize: asset.motion.poster?.size ?? 0 } : null } : null,
        assetCount: assets.length, syncState: syncState ? { deviceId: syncState.deviceId, clock: syncState.clock,
          generation: syncState.generation, hasAcceptedSnapshot: syncState.hasAcceptedSnapshot ?? false,
          lastSync: syncState.lastSync ? { runId: syncState.lastSync.runId, status: syncState.lastSync.status,
            phase: syncState.lastSync.phase } : null } : null };
    } finally {
      db.close();
    }
  });
}

export async function manuallySync(page) {
  await openSettingsTab(page, '数据');
  const panel = page.locator('section[aria-labelledby="webdav-connected-title"]');
  const button = panel.getByRole('button', { name: /立即同步|处理中/ });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const previousRunId = (await readMotionState(page)).syncState?.lastSync?.runId ?? null;
  const startedAt = Date.now();
  await button.click();
  await expect.poll(async () => {
    const lastSync = (await readMotionState(page)).syncState?.lastSync;
    return Boolean(lastSync && lastSync.runId !== previousRunId && lastSync.status === 'succeeded');
  }, { timeout: 120_000 }).toBe(true);
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await expect(panel.getByText('已同步', { exact: true })).toBeVisible({ timeout: 60_000 });
  return { elapsedMs: Date.now() - startedAt,
    runId: (await readMotionState(page)).syncState?.lastSync?.runId };
}

export async function assertPlaying({ page, mime }) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeHidden();
  const playButton = page.getByRole('button', { name: '播放动态壁纸' }).first();
  if (await playButton.count()) await playButton.click();
  if (mime.startsWith('video/')) {
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some((video) => !video.paused && video.currentTime > 0), null, { timeout: 30_000 });
    return page.locator('video').first().evaluate((video) => ({ muted: video.muted, loop: video.loop, currentTime: video.currentTime }));
  }
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some((image) => image.src.startsWith('blob:') && image.complete && image.naturalWidth > 0), null, { timeout: 30_000 });
  return { animationImageLoaded: true };
}

export async function assertBackgroundPause({ context, page }) {
  const pageSession = await context.newCDPSession(page);
  await pageSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const before = await page.locator('video').first().evaluate((video) => video.currentTime);
  const otherPage = await context.newPage();
  const otherSession = await context.newCDPSession(otherPage);
  await otherSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  try {
    await otherPage.goto('data:text/html,<title>visibility audit</title>');
    await otherPage.bringToFront();
    try {
      await page.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 15_000 });
    } catch (error) {
      const states = await Promise.all([page, otherPage].map((tab) => tab.evaluate(() => ({
        visibility: document.visibilityState, focused: document.hasFocus(), url: location.href,
      }))));
      if (states.every(({ visibility }) => visibility === 'visible')) {
        return { verified: false, reason: '两份 headed Chromium 页面在真实标签切换后仍报告 visible', states,
          timeout: error instanceof Error ? error.message : String(error) };
      }
      throw new Error(`真实页面切换产生了意外状态：${JSON.stringify(states)}`, { cause: error });
    }
    await expect.poll(() => page.locator('video').first().evaluate((video) => video.paused)).toBe(true);
    const pausedAt = await page.locator('video').first().evaluate((video) => video.currentTime);
    await page.waitForTimeout(350);
    const stillPausedAt = await page.locator('video').first().evaluate((video) => video.currentTime);
    if (Math.abs(stillPausedAt - pausedAt) > 0.05) throw new Error('页面隐藏后视频仍在播放');
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 15_000 });
    await expect.poll(() => page.locator('video').first().evaluate((video) => !video.paused)).toBe(true);
    const resumedAt = await page.locator('video').first().evaluate((video) => video.currentTime);
    if (resumedAt < before) throw new Error('页面恢复后视频没有从暂停位置继续');
    return { verified: true, visibilityChanged: true, pausedAt, stillPausedAt, resumedAt };
  } finally {
    await page.bringToFront();
    await otherSession.detach();
    await pageSession.detach();
    await otherPage.close();
  }
}

export async function exportBackup(page, destination) {
  await openSettingsTab(page, '数据');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ZIP', exact: true }).click();
  const download = await downloaded;
  await download.saveAs(destination);
  return { suggestedFilename: download.suggestedFilename(), path: destination };
}

export async function importBackup(page, path) {
  await openSettingsTab(page, '数据');
  await page.locator('#backup-file').setInputFiles(path);
  await expect(page.getByRole('heading', { name: '替换本机数据？' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('heading', { name: '替换本机数据？' })).toBeHidden({ timeout: 60_000 });
  return readMotionState(page);
}

export async function assertNoSyncOffline(context, page, expectedServerRequestCount) {
  const externalRequests = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const before = page.url();
  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible({ timeout: 30_000 });
  if (page.url() !== before || externalRequests.length) throw new Error(`离线新标签页发起了网络请求：${externalRequests.join(', ')}`);
  return { offline: true, externalRequests: externalRequests.length, fixtureRequestsBefore: expectedServerRequestCount };
}

export function assertNoPageErrors(profiles) {
  const errors = profiles.flatMap(({ name, errors: items }) => items.map((message) => ({ profile: name, message })));
  if (errors.length) throw new Error(`扩展页面错误：${JSON.stringify(errors)}`);
}
