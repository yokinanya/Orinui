import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBackgroundPause, assertBetaAbout, assertNoPageErrors, assertNoSyncOffline, assertPlaying, createWebDavVault,
  exportBackup, importBackup, joinWebDavVault, launchAuditProfile, manuallySync, readMotionState, uploadMotion,
} from './beta-audit-browser.mjs';
import { startWebDavFixture } from './beta-audit-webdav.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPENSSL = 'C:/Users/yokinanya/scoop/apps/git/current/usr/bin/openssl.exe';
const PERFORMANCE_MEDIA = '.output/media-performance/loop-1080p.mp4';

function assertContained(root, target) {
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(root, rel) !== target) {
    throw new Error(`测试路径超出输出目录：${target}`);
  }
}

async function makeWorkspace() {
  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const root = join(REPOSITORY_ROOT, '.output', 'beta-extension-audit', runId);
  const extensionPath = join(root, 'extension');
  const profilesPath = join(root, 'profiles');
  const downloadsPath = join(root, 'downloads');
  for (const path of [extensionPath, profilesPath, downloadsPath]) assertContained(root, path);
  await mkdir(root, { recursive: true });
  return { root, extensionPath, profilesPath, downloadsPath };
}

async function prepareExtensionCopy(workspace) {
  const built = join(REPOSITORY_ROOT, '.output', 'chrome-mv3');
  await cp(built, workspace.extensionPath, { recursive: true, force: true });
  const manifestPath = join(workspace.extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), 'https://localhost/*'])];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath };
}

async function makeCertificate(workspace) {
  const directory = join(workspace.root, 'certificate');
  await mkdir(directory, { recursive: true });
  const keyPath = join(directory, 'localhost.key');
  const certificatePath = join(directory, 'localhost.crt');
  execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout', keyPath, '-out', certificatePath], { stdio: 'ignore' });
  return { key: await readFile(keyPath), certificate: await readFile(certificatePath) };
}

async function verifyEncryptedMedia({ fixture, stored, filePath, label }) {
  const encryptedPath = `/dav/Orinui/vaults/${fixture.vaultId}/assets/${stored.asset.id}.enc`;
  const object = fixture.state.entries.get(encryptedPath);
  if (!object || object.collection) throw new Error(`${label}没有创建 WebDAV 密文对象：${encryptedPath}`);
  const plaintext = await readFile(filePath);
  if (object.bytes.length <= plaintext.length || object.bytes.indexOf(plaintext) !== -1) {
    throw new Error(`${label}远端对象不是可识别的端到端加密密文`);
  }
  return { path: encryptedPath, plaintextBytes: plaintext.length, ciphertextBytes: object.bytes.length };
}

function fixtureVaultId(fixture) {
  const manifest = fixture.state.entries.get('/dav/Orinui/vault.json');
  if (!manifest || manifest.collection) throw new Error('WebDAV fixture 缺少同步库描述对象');
  const descriptor = JSON.parse(manifest.bytes.toString('utf8'));
  if (!descriptor.vaultId || !descriptor.ciphertext) throw new Error('同步库描述格式无效');
  return descriptor.vaultId;
}

function snapshotSummary(snapshot) {
  const appearance = snapshot.settings.appearance;
  return { deviceId: snapshot.deviceId, generation: snapshot.generation,
    appearanceClock: appearance.clock, appearanceDeviceId: appearance.deviceId,
    background: appearance.value.background,
    assets: snapshot.assets.map(({ id, mime, motion }) => ({ id, mime, motion })) };
}

async function decryptSnapshot(fixture, input) {
  const objectPath = `/dav/Orinui/vaults/${input.vaultId}/devices/${input.deviceId}/snapshot.enc`;
  const object = fixture.state.entries.get(objectPath);
  if (!object || object.collection) throw new Error(`同步快照密文缺失：${objectPath}`);
  const encodedKey = input.recoveryKey.replaceAll('-', '+').replaceAll('_', '/') + '=';
  const keyBytes = Uint8Array.from(atob(encodedKey), (character) => character.charCodeAt(0));
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const packet = new Uint8Array(object.bytes);
  const magic = new TextDecoder().decode(packet.subarray(0, 8));
  if (magic !== 'ORINUI01') throw new Error('fixture 中的快照不是预期的加密包');
  const iv = packet.slice(8, 20);
  const additionalData = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1,
    vaultId: input.vaultId, kind: 'snapshot', objectId: input.deviceId }));
  const plaintext = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, packet.slice(20));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
}

async function runMediaCycle(input) {
  const { name, path, mime, kind, profileA, profileB, fixture } = input;
  const startedAt = Date.now();
  const storedA = await uploadMotion({ page: profileA.page, filePath: path, mime, kind });
  const syncAms = await manuallySync(profileA.page);
  const snapshotA = snapshotSummary(await decryptSnapshot(fixture, { vaultId: fixture.vaultId,
    deviceId: storedA.syncState.deviceId, recoveryKey: input.recoveryKey }));
  const activeAsset = snapshotA.assets.find(({ id }) => id === snapshotA.background.assetId);
  if (snapshotA.background.kind !== 'motion' || activeAsset?.mime !== mime) {
    throw new Error(`${name}没有出现在 A 设备的已发布快照：${JSON.stringify(snapshotA)}`);
  }
  const encrypted = await verifyEncryptedMedia({ fixture, stored: storedA, filePath: path, label: name });
  const syncBms = await manuallySync(profileB.page);
  const storedB = await readMotionState(profileB.page);
  if (!storedB.asset || storedB.background.kind !== 'motion' || storedB.asset.mime !== mime
    || storedB.asset.motion?.kind !== kind || storedB.asset.motion.posterSize === 0) {
    const snapshotB = snapshotSummary(await decryptSnapshot(fixture, { vaultId: fixture.vaultId,
      deviceId: storedB.syncState.deviceId, recoveryKey: input.recoveryKey }));
    throw new Error(`${name}在第二配置文件中的媒体或封面不完整：${JSON.stringify({ local: storedB, snapshotA, snapshotB })}`);
  }
  const playback = await assertPlaying({ page: profileB.page, mime });
  const visibility = mime.startsWith('video/') ? await assertBackgroundPause({ context: profileB.context, page: profileB.page }) : null;
  const snapshotB = snapshotSummary(await decryptSnapshot(fixture, { vaultId: fixture.vaultId,
    deviceId: storedB.syncState.deviceId, recoveryKey: input.recoveryKey }));
  return { name, syncElapsedMs: Date.now() - startedAt, syncAms, syncBms, encrypted,
    received: storedB.asset, playback, visibility, snapshots: { deviceA: snapshotA, deviceB: snapshotB } };
}

async function runOfflineAndRestore({ workspace, profileA, fixture, version, profiles }) {
  const profileC = await launchAuditProfile({ extensionPath: workspace.extensionPath,
    profilePath: join(workspace.profilesPath, 'offline-restore'), downloadsPath: workspace.downloadsPath });
  profiles.push({ name: 'offline-restore', ...profileC });
  if (profileC.networkRequests.length) throw new Error(`未启用同步的首次新标签页访问了网络：${profileC.networkRequests.join(', ')}`);
  const requestCount = fixture.state.requests.length;
  const offline = await assertNoSyncOffline(profileC.context, profileC.page, requestCount);
  if (fixture.state.requests.length !== requestCount) throw new Error('未启用同步的扩展联系了 WebDAV fixture');
  const about = await assertBetaAbout(profileC.page, version);
  const backupPath = join(workspace.root, 'orinui-beta-audit.zip');
  const backup = await exportBackup(profileA.page, backupPath);
  const backupBytes = await stat(backupPath);
  const restored = await importBackup(profileC.page, backupPath);
  if (restored.background.kind !== 'motion' || !restored.asset || !restored.asset.motion?.posterSize) {
    throw new Error('ZIP 恢复后动态媒体或重建封面缺失');
  }
  if (restored.syncState !== null) throw new Error('ZIP 恢复意外写入了 WebDAV 同步状态');
  const playback = await assertPlaying({ page: profileC.page, mime: restored.asset.mime });
  const screenshotPath = join(workspace.root, 'zip-restored-home.png');
  await profileC.page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  return { profileC, offline, about, backup: { ...backup, bytes: backupBytes.size },
    restored: restored.asset, playback, screenshotPath };
}

async function maybePerformancePath() {
  const path = join(REPOSITORY_ROOT, PERFORMANCE_MEDIA);
  try { await stat(path); return path; }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function launchDevice({ name, workspace, profiles, headed = false }) {
  const launched = await launchAuditProfile({ extensionPath: workspace.extensionPath,
    profilePath: join(workspace.profilesPath, name), downloadsPath: workspace.downloadsPath, headed });
  const profile = { name, ...launched };
  profiles.push(profile);
  return profile;
}

async function runMotionSamples({ profileA, profileB, fixture, performancePath, vaultId, recoveryKey }) {
  const samples = [
    { name: 'motion.webm', path: join(REPOSITORY_ROOT, 'tests', 'fixtures', 'motion.webm'), mime: 'video/webm', kind: 'video' },
    { name: 'motion.gif', path: join(REPOSITORY_ROOT, 'tests', 'fixtures', 'motion.gif'), mime: 'image/gif', kind: 'animation' },
    ...(performancePath ? [{ name: 'loop-1080p.mp4', path: performancePath, mime: 'video/mp4', kind: 'video' }] : []),
  ];
  const results = [];
  for (const sample of samples) results.push(await runMediaCycle({ ...sample, profileA, profileB, fixture, vaultId, recoveryKey }));
  return results;
}

async function runDeviceSyncAudit({ workspace, manifest, fixture, profiles, version, report }) {
  report.step = 'launch-first-profile';
  const profileA = await launchDevice({ name: 'device-a', workspace, profiles });
  const aboutA = await assertBetaAbout(profileA.page, version);
  report.step = 'create-webdav-vault';
  const recoveryKey = await createWebDavVault(profileA.page, fixture.url);
  fixture.vaultId = fixtureVaultId(fixture);
  report.step = 'launch-second-profile';
  const profileB = await launchDevice({ name: 'device-b', workspace, profiles, headed: true });
  report.step = 'join-webdav-vault';
  await joinWebDavVault(profileB.page, fixture.url, recoveryKey);
  report.step = 'sync-dynamic-media';
  const performancePath = await maybePerformancePath();
  const media = await runMotionSamples({ profileA, profileB, fixture, performancePath,
    vaultId: fixture.vaultId, recoveryKey });
  return { profileA, aboutA, media, profileNames: [profiles[0].name, profileB.name] };
}

function fixtureMethodCounts(fixture) {
  return fixture.state.requests.reduce((counts, request) => ({
    ...counts, [request.method]: (counts[request.method] ?? 0) + 1,
  }), {});
}

async function buildSuccessReport(input) {
  assertNoPageErrors(input.profiles);
  const fixtureMethods = fixtureMethodCounts(input.fixture);
  const visibility = input.sync.media.filter(({ visibility: check }) => check !== null);
  const unverifiedVisibility = visibility.filter(({ visibility: check }) => !check.verified);
  return {
    status: unverifiedVisibility.length ? 'partial' : 'passed', startedAt: input.startedAt,
    completedAt: new Date().toISOString(), version: input.version,
    manifestVersion: input.manifest.version, manifestVersionName: input.manifest.version_name,
    hostPermissionTestSetup: input.manifest.host_permissions.includes('https://localhost/*'),
    permissionPromptCovered: false,
    profiles: [...input.sync.profileNames, 'offline-restore'], webdavMethods: fixtureMethods,
    webdavObjects: input.fixture.state.entries.size, media: input.sync.media,
    unverified: unverifiedVisibility.map(({ name, visibility: check }) => ({ name, ...check })),
    offlineAndZip: { offline: input.restored.offline, about: input.restored.about,
      backup: input.restored.backup, restored: input.restored.restored,
      playback: input.restored.playback, screenshotPath: input.restored.screenshotPath },
    about: input.sync.aboutA, errors: [],
  };
}

async function writeReport(path, report) {
  await writeFile(path, JSON.stringify(report, null, 2));
}

async function closeAuditResources({ profiles, fixture, workspace }) {
  const failures = [];
  for (const profile of profiles.toReversed()) {
    try { await profile.context.close(); }
    catch (error) { failures.push(error); }
  }
  if (fixture) {
    try { await fixture.close(); }
    catch (error) { failures.push(error); }
  }
  const profileRoot = join(workspace.profilesPath);
  assertContained(workspace.root, profileRoot);
  try { await rm(profileRoot, { recursive: true, force: true }); }
  catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, '审计临时资源清理失败');
}

async function main() {
  const workspace = await makeWorkspace();
  const reportPath = join(workspace.root, 'report.json');
  const startedAt = new Date().toISOString();
  const profiles = [];
  let fixture;
  const state = { step: 'workspace' };
  try {
    const { manifest } = await prepareExtensionCopy(workspace);
    const version = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8')).version;
    const tls = await makeCertificate(workspace);
    fixture = await startWebDavFixture(tls);
    const sync = await runDeviceSyncAudit({ workspace, manifest, fixture, profiles, version, report: state });
    state.step = 'offline-and-zip-restore';
    const restored = await runOfflineAndRestore({ workspace, profileA: sync.profileA, fixture, version, profiles });
    const result = await buildSuccessReport({ startedAt, version, manifest, profiles, fixture, sync, restored });
    await writeReport(reportPath, result);
    console.log(JSON.stringify({ reportPath, status: result.status, media: result.media,
      webdavMethods: result.webdavMethods, zipBytes: result.offlineAndZip.backup.bytes }));
  } catch (error) {
    const result = { status: 'failed', startedAt, failedAt: new Date().toISOString(), step: state.step,
      error: error instanceof Error ? error.message : String(error),
      fixtureObjects: fixture ? [...fixture.state.entries.keys()] : [],
      fixtureRequests: fixture?.state.requests.slice(-60).map(({ method, path }) => ({ method, path })) };
    await writeReport(reportPath, result);
    throw error;
  } finally {
    await closeAuditResources({ profiles, fixture, workspace });
  }
}

await main();
