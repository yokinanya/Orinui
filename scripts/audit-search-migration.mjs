import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const extensionPath = resolve('.output/chrome-mv3');
const auditDirectory = resolve('.output/search-audit');
const reportPath = join(auditDirectory, 'migration-report.json');
const databaseName = 'orinui';


async function readSettings(page) {
  return page.evaluate(async (name) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const settings = await new Promise((resolve, reject) => {
      const request = database.transaction('settings').objectStore('settings').get('app');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return settings;
  }, databaseName);
}

async function deleteDatabase(page) {
  await page.evaluate(async (name) => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Extension database deletion was blocked'));
  }), databaseName);
}

async function createCryptoProof(page) {
  return page.evaluate(async () => {
    const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('orinui-search-migration-key-proof');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);
    globalThis.__auditSearchMigrationKey = cryptoKey;
    return { iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] };
  });
}

function createLegacyRows(currentSettings, deviceId, vaultId) {
  const { customization: _customization, ...oldSearch } = currentSettings.search;
  const { home: _home, ...legacySettings } = currentSettings;
  const oldSettings = { ...legacySettings, search: { ...oldSearch, width: 'wide', autoFocus: true, openTarget: 'new-tab' } };
  const syncRegister = (value, clock) => ({ value, clock, deviceId });
  const rows = {
    folders: [{ id: 'audit-folder', name: '迁移文件夹', order: 2 }],
    shortcuts: [{ id: 'audit-site', folderId: 'audit-folder', title: '迁移网站', url: 'https://example.test/',
      icon: { kind: 'built-in', iconId: 'book' }, iconSourceUrl: null, order: 4 }],
    settings: [{ id: 'app', ...oldSettings }],
    sync_state: [{ id: 'app', vaultId, deviceId, clock: 42, generation: 13, suspended: false, hasAcceptedSnapshot: true }],
    sync_records: [
      { id: 'folder:audit-folder', kind: 'folder', entityId: 'audit-folder',
        value: { id: 'audit-folder', name: syncRegister('迁移文件夹', 7), position: syncRegister(2, 8) } },
      { id: 'shortcut:audit-site', kind: 'shortcut', entityId: 'audit-site',
        value: { id: 'audit-site', title: syncRegister('迁移网站', 9), url: syncRegister('https://example.test/', 10),
          placement: syncRegister({ folderId: 'audit-folder', order: 4 }, 11),
          icon: syncRegister({ kind: 'built-in', iconId: 'book' }, 12) } },
      { id: 'settings:app', kind: 'settings', entityId: 'app', value: {
        appearance: syncRegister(oldSettings.appearance, 14), defaultEngineId: syncRegister(oldSearch.defaultEngineId, 15),
        layout: syncRegister(oldSettings.layout, 16), clock: syncRegister(oldSettings.clock, 17),
        searchPreferences: syncRegister({ width: 'wide', autoFocus: true, openTarget: 'new-tab' }, 18),
        shortcutPreferences: syncRegister(oldSettings.shortcuts, 19), customEngines: [],
      } },
    ],
    sync_keys: [{ id: vaultId, key: true }],
  };
  return rows;
}

async function createLegacyDatabase(page, currentSettings, keyProof) {
  const deviceId = 'audit-device-11';
  const vaultId = 'audit-vault-11';
  const rows = createLegacyRows(currentSettings, deviceId, vaultId);
  await page.evaluate(async ({ name, rows, indexes }) => {
    const request = indexedDB.open(name, 110);
    request.onupgradeneeded = () => {
      for (const [storeName, storeIndexes] of Object.entries(indexes)) {
        const store = request.result.createObjectStore(storeName, { keyPath: 'id' });
        for (const [indexName, keyPath] of storeIndexes) store.createIndex(indexName, keyPath);
      }
    };
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(Object.keys(rows), 'readwrite');
    for (const [storeName, records] of Object.entries(rows)) {
      for (const row of records) transaction.objectStore(storeName).put({ ...row,
        ...(storeName === 'sync_keys' ? { key: globalThis.__auditSearchMigrationKey } : {}) });
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Legacy database seeding aborted'));
    });
    database.close();
  }, { name: databaseName, rows, indexes: { folders: [['order', 'order']], shortcuts: [['folderId', 'folderId'], ['order', 'order']],
    settings: [], assets: [['kind', 'kind']], sync_state: [], sync_records: [['kind', 'kind'], ['entityId', 'entityId']], sync_keys: [] } });
  return { deviceId, vaultId, ...keyProof, oldSearch: { width: 'wide', autoFocus: true, openTarget: 'new-tab' } };
}

async function waitForMigration(page) {
  await page.waitForFunction(async (name) => {
    const request = indexedDB.open(name);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const version = request.result.version;
        request.result.close();
        resolve(version === 140);
      };
      request.onerror = () => reject(request.error);
    });
  }, databaseName, { timeout: 15_000 });
}

async function readMigratedData(page, proof) {
  return page.evaluate(async ({ name, keyId, iv, ciphertext }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['settings', 'sync_state', 'sync_records', 'sync_keys', 'folders', 'shortcuts']);
      const output = {};
      for (const storeName of ['settings', 'sync_state', 'sync_records', 'sync_keys', 'folders', 'shortcuts']) {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => { output[storeName] = request.result; };
        request.onerror = () => reject(request.error);
      }
      transaction.oncomplete = () => resolve(output);
      transaction.onerror = () => reject(transaction.error);
    });
    const version = database.version;
    database.close();
    const key = rows.sync_keys.find((row) => row.id === keyId)?.key;
    if (!key) throw new Error('Migrated encryption key is missing');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(ciphertext));
    return { version, settings: rows.settings.find(({ id }) => id === 'app'),
      state: rows.sync_state.find(({ id }) => id === 'app'),
      settingsRecord: rows.sync_records.find(({ id }) => id === 'settings:app'),
      folderRecord: rows.sync_records.find(({ id }) => id === 'folder:audit-folder'),
      shortcutRecord: rows.sync_records.find(({ id }) => id === 'shortcut:audit-site'),
      folder: rows.folders.find(({ id }) => id === 'audit-folder'),
      shortcut: rows.shortcuts.find(({ id }) => id === 'audit-site'),
      decryptedProof: new TextDecoder().decode(plaintext), keyExtractable: key.extractable };
  }, { name: databaseName, keyId: proof.vaultId, iv: proof.iv, ciphertext: proof.ciphertext });
}

function assertMigratedData(input) {
  const { migrated, currentSettings, proof, externalRequests } = input;
  assert.equal(migrated.version, 140);
  assert.deepEqual(migrated.settings.home, { widgets: [], placements: [
    { id: 'folder:audit-folder', column: 0, row: 0, height: 1 },
  ] });
  assert.ok(migrated.settingsRecord.value.home, 'Home sync registers must be seeded');
  assert.deepEqual(migrated.state, { id: 'app', vaultId: proof.vaultId, deviceId: proof.deviceId,
    clock: 42, generation: 13, suspended: false, hasAcceptedSnapshot: true });
  assert.deepEqual(migrated.settings.search.customization, currentSettings.search.customization);
  assert.deepEqual({ width: migrated.settings.search.width, autoFocus: migrated.settings.search.autoFocus,
    openTarget: migrated.settings.search.openTarget }, proof.oldSearch);
  assert.deepEqual(migrated.settingsRecord.value.searchPreferences.value, proof.oldSearch);
  assert.deepEqual(migrated.settingsRecord.value.searchCustomization, {
    value: currentSettings.search.customization, clock: 0, deviceId: proof.deviceId,
  });
  assert.deepEqual([migrated.settingsRecord.value.appearance.clock, migrated.settingsRecord.value.defaultEngineId.clock,
    migrated.settingsRecord.value.layout.clock, migrated.settingsRecord.value.clock.clock,
    migrated.settingsRecord.value.shortcutPreferences.clock], [14, 15, 16, 17, 19]);
  assert.equal(migrated.folder.name, '迁移文件夹');
  assert.equal(migrated.shortcut.url, 'https://example.test/');
  assert.equal(migrated.folderRecord.value.name.value, '迁移文件夹');
  assert.equal(migrated.shortcutRecord.value.placement.value.folderId, 'audit-folder');
  assert.equal(migrated.decryptedProof, 'orinui-search-migration-key-proof');
  assert.equal(migrated.keyExtractable, false);
  assert.equal(externalRequests, 0);
}

async function verifyHomePersistence(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  const note = page.getByLabel('便签内容');
  await note.fill('<b>真实扩展纯文本</b>\n迁移后保存');
  const item = page.locator('[data-home-item]').filter({ has: note });
  await item.hover();
  await item.getByRole('button', { name: '选择位置', exact: true }).click();
  await page.getByRole('button', { name: '下移一格', exact: true }).click();
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  const draft = page.getByLabel('新待办', { exact: true });
  await draft.fill('真实扩展待办');
  await draft.press('Enter');
  const checkbox = page.getByRole('checkbox', { name: '完成 真实扩展待办' });
  await checkbox.press('Space');
  await page.waitForFunction(async () => {
    const request = indexedDB.open('orinui');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const settings = await new Promise((resolve, reject) => {
      const query = db.transaction('settings').objectStore('settings').get('app');
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    db.close();
    return settings.home.widgets.some((widget) => widget.items.some((item) => item.completed));
  });
  const saved = (await readSettings(page)).home;
  await page.reload();
  assert.equal(await note.inputValue(), '<b>真实扩展纯文本</b>\n迁移后保存');
  assert.equal(await checkbox.isChecked(), true);
  assert.deepEqual((await readSettings(page)).home, saved);
  return saved;
}

async function runAudit() {
  const profilePath = join(auditDirectory, `profile-${randomUUID()}`);
  await mkdir(profilePath, { recursive: true });
  let context;
  let externalRequests = 0;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      ...(process.env.ORINUI_AUDIT_CHROMIUM
        ? { executablePath: process.env.ORINUI_AUDIT_CHROMIUM, channel: 'chromium' }
        : { channel: 'chrome' }),
      headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    page.on('request', (request) => { if (/^https?:/i.test(request.url())) externalRequests += 1; });
    await page.goto('chrome://newtab');
    await page.waitForURL(/^chrome-extension:\/\//, { timeout: 15_000 });
    const extensionId = new URL(page.url()).hostname;
    await page.goto(`chrome-extension://${extensionId}/newtab.html`);
    await page.getByRole('button', { name: '设置', exact: true }).waitFor();
    await expect.poll(() => readSettings(page), { timeout: 15_000 }).toMatchObject({
      search: { customization: expect.any(Object) },
    });
    const currentSettings = await readSettings(page);
    assert.ok(currentSettings.search?.customization, 'Fresh extension must expose current settings');
    for (const extraPage of context.pages()) if (extraPage !== page) await extraPage.close();
    await page.goto(`chrome-extension://${extensionId}/icon/16.png`);
    await deleteDatabase(page);
    const keyProof = await createCryptoProof(page);
    const proof = await createLegacyDatabase(page, currentSettings, keyProof);
    await page.goto(`chrome-extension://${extensionId}/newtab.html`);
    await waitForMigration(page);
    await page.goto(`chrome-extension://${extensionId}/icon/16.png`);
    const migrated = await readMigratedData(page, proof);
    assertMigratedData({ migrated, currentSettings, proof, externalRequests });
    const persistedHome = await verifyHomePersistence(page, extensionId);
    assert.equal(externalRequests, 0);
    return { status: 'passed', persistedHome, chromeVersion: context.browser()?.version() ?? 'unknown', extensionId,
      databaseVersion: migrated.version, preserved: ['settings', 'folder', 'shortcut', 'vaultId', 'deviceId',
        'clock', 'generation', 'nonextractable CryptoKey'], migratedSearchRegister: migrated.settingsRecord.value.searchCustomization,
      externalRequests };
  } finally {
    await context?.close();
    await rm(profilePath, { recursive: true, force: true });
  }
}

await mkdir(auditDirectory, { recursive: true });
try {
  const report = await runAudit();
  await import('node:fs/promises').then(({ writeFile }) => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
} catch (error) {
  const report = { status: 'failed', error: error instanceof Error ? error.stack : String(error) };
  await import('node:fs/promises').then(({ writeFile }) => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`));
  process.stderr.write(`${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
  process.exitCode = 1;
}
