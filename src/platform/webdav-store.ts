import { parseWebDavVaultManifest, validateStrongEtag, validateWebDavIdentity } from '@/domain/webdav/validation';
import type { SyncObjectAddress, SyncSnapshotHead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';
import type { SyncObjectStore } from '@/sync/objects';
import { createWebDavClient, type WebDavInput, type WebDavClient } from '@/platform/webdav-client';
import { base64, childIdentity, fromBase64, propfind, requireCollection, propfindIfPresent } from '@/platform/webdav-protocol';
import { bytesBody, equalBytes, exactWebDavEntry, readObject, readResourceRevision, writeReceiptRevision } from '@/platform/webdav-resource';
import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';

export type WebDavRemoteInput = WebDavInput;

const NUTSTORE_ANCESTORS_NOT_FOUND = /<(?:[A-Za-z_][\w.-]*:)?exception\b[^>]*>\s*AncestorsNotFound\s*<\/(?:[A-Za-z_][\w.-]*:)?exception\s*>/;

export interface WebDavRemote {
  readonly objects: SyncObjectStore;
  readVault(): Promise<{ readonly vaultId: string; readonly ciphertext: Uint8Array } | null>;
  createVault(input: { readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void>;
  prepareCollections(input: { readonly vaultId: string; readonly deviceId: string }): Promise<void>;
  verifyConditions(input: { readonly vaultId: string; readonly deviceId: string }): Promise<void>;
}

function collectionUrl(client: WebDavClient, ...segments: readonly string[]): URL {
  const url = client.url(...segments);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function assetUrl(client: WebDavClient, address: SyncObjectAddress): URL {
  validateWebDavIdentity(address.vaultId, '同步库');
  validateWebDavIdentity(address.objectId, '媒体');
  return client.url('vaults', address.vaultId, 'assets', `${address.objectId}.enc`);
}

function snapshotUrl(client: WebDavClient, address: SyncObjectAddress): URL {
  validateWebDavIdentity(address.vaultId, '同步库');
  validateWebDavIdentity(address.objectId, '设备');
  return client.url('vaults', address.vaultId, 'devices', address.objectId, 'snapshot.enc');
}

async function snapshotRevision(client: WebDavClient, url: URL): Promise<string | null> {
  return readResourceRevision(client, url, '设备快照');
}

async function listSnapshots(client: WebDavClient, input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]> {
  validateWebDavIdentity(input.vaultId, '同步库');
  const collection = collectionUrl(client, 'vaults', input.vaultId, 'devices');
  const entries = await propfind(client, collection, '1');
  const seen = new Set<string>();
  const deviceIds: string[] = [];
  for (const entry of entries) {
    const deviceId = childIdentity(entry.href, collection);
    if (deviceId === null) continue;
    requireCollection(entry, 'devices 子项');
    if (seen.has(deviceId)) throw new Error(`WebDAV 设备路径重复：${deviceId}`);
    seen.add(deviceId);
    deviceIds.push(deviceId);
  }
  const revisions = await Promise.all(deviceIds.map(async (deviceId) => ({ deviceId,
    revision: await snapshotRevision(client, snapshotUrl(client, { vaultId: input.vaultId, objectId: deviceId })) })));
  const heads = revisions.filter((head): head is SyncSnapshotHead => head.revision !== null);
  return heads.toSorted((left, right) => left.deviceId < right.deviceId ? -1 : Number(left.deviceId !== right.deviceId));
}

async function createAsset(client: WebDavClient, input: SyncObjectAddress & { readonly ciphertext: Uint8Array }): Promise<SyncAssetReceipt> {
  if (input.ciphertext.length === 0) throw new Error('不能上传空的 WebDAV 媒体对象');
  const url = assetUrl(client, input);
  if (client.consistencyMode === 'readback-only') {
    const existing = await readObject({ client, url, label: '媒体' });
    if (existing) return { created: false, revision: existing.revision };
    const response = await client.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
      body: bytesBody(input.ciphertext) });
    if (!response.ok) throw new Error(`WebDAV 创建媒体失败（HTTP ${response.status}）`);
    return { created: true, revision: await writeReceiptRevision({ client, url, label: '媒体创建回执',
      response, expectedBytes: input.ciphertext }) };
  }
  const response = await client.request(url, { method: 'PUT', headers: {
    'If-None-Match': '*', 'Content-Type': 'application/octet-stream',
  }, body: bytesBody(input.ciphertext) });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) {
    const existing = await readObject({ client, url, label: '媒体' });
    if (!existing) throw new Error('WebDAV 媒体条件竞争后对象不存在');
    return { created: false, revision: existing.revision };
  }
  if (!response.ok) throw new Error(`WebDAV 创建媒体失败（HTTP ${response.status}）`);
  return { created: true, revision: await writeReceiptRevision({ client, url, label: '媒体创建回执',
    response, expectedBytes: input.ciphertext }) };
}

function appendByte(bytes: Uint8Array, value: number): Uint8Array {
  const result = new Uint8Array(bytes.length + 1);
  result.set(bytes);
  result[bytes.length] = value;
  return result;
}

function expectPreconditionFailure(response: Response, label: string): void {
  if (response.status !== WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error(`WebDAV ${label}条件未生效（预期 HTTP ${WEBDAV_HTTP_STATUS.preconditionFailed}，实际 ${response.status}）`);
}

async function runConditionProbe(client: WebDavClient, url: URL, probe: Uint8Array): Promise<void> {
  const changed = appendByte(probe, 0);
  const created = await client.request(url, { method: 'PUT', headers: {
    'If-None-Match': '*', 'Content-Type': 'application/octet-stream',
  }, body: bytesBody(probe) });
  if (!created.ok) throw new Error(`WebDAV 条件探测对象创建失败（HTTP ${created.status}）`);
  const revision = await writeReceiptRevision({ client, url, label: '条件探测创建回执', response: created, expectedBytes: probe });
  const duplicate = await client.request(url, { method: 'PUT', headers: {
    'If-None-Match': '*', 'Content-Type': 'application/octet-stream',
  }, body: bytesBody(changed) });
  expectPreconditionFailure(duplicate, 'If-None-Match');
  const incorrect = revision === '"orinui-probe-mismatch"' ? '"orinui-probe-mismatch-2"' : '"orinui-probe-mismatch"';
  const wrongWrite = await client.request(url, { method: 'PUT', headers: {
    'If-Match': incorrect, 'Content-Type': 'application/octet-stream',
  }, body: bytesBody(changed) });
  expectPreconditionFailure(wrongWrite, 'If-Match PUT');
  const wrongDelete = await client.request(url, { method: 'DELETE', headers: { 'If-Match': incorrect } });
  expectPreconditionFailure(wrongDelete, 'If-Match DELETE');
  const verified = await readObject({ client, url, label: '条件探测对象', revision });
  if (!verified || verified.revision !== revision || !equalBytes(verified.ciphertext, probe)) {
    throw new Error('WebDAV 条件探测对象的强 ETag 或内容发生变化');
  }
  const deleted = await client.request(url, { method: 'DELETE', headers: { 'If-Match': revision } });
  if (!deleted.ok) throw new Error(`WebDAV 条件探测对象无法以强 ETag 删除（HTTP ${deleted.status}）`);
  if (await readObject({ client, url, label: '条件探测对象' })) throw new Error('WebDAV 条件探测对象在条件删除后仍存在');
}

async function verifyConditions(client: WebDavClient,
  input: { readonly vaultId: string; readonly deviceId: string }): Promise<void> {
  validateWebDavIdentity(input.vaultId, '同步库');
  validateWebDavIdentity(input.deviceId, '设备');
  const url = client.url('vaults', input.vaultId, `probe-${input.deviceId}-${crypto.randomUUID()}.enc`);
  const probe = new TextEncoder().encode(`Orinui WebDAV condition probe v1:${input.vaultId}:${input.deviceId}`);
  try {
    if (client.consistencyMode === 'readback-only') await runReadbackProbe(client, url, probe);
    else await runConditionProbe(client, url, probe);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const capability = client.consistencyMode === 'readback-only' ? '读写回读能力' : '条件能力';
    throw new Error(`WebDAV ${capability}验证失败：${detail}；诊断对象可能保留在 ${url.pathname}`, { cause });
  }
}

async function runReadbackProbe(client: WebDavClient, url: URL, probe: Uint8Array): Promise<void> {
  const created = await client.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
    body: bytesBody(probe) });
  if (!created.ok) throw new Error(`WebDAV 回读探测对象创建失败（HTTP ${created.status}）`);
  const verified = await readObject({ client, url, label: '回读探测对象' });
  if (!verified || !equalBytes(verified.ciphertext, probe)) throw new Error('WebDAV 回读探测内容与写入不一致');
  const deleted = await client.request(url, { method: 'DELETE' });
  if (!deleted.ok) throw new Error(`WebDAV 回读探测对象清理失败（HTTP ${deleted.status}）`);
  if (await readObject({ client, url, label: '回读探测对象' })) throw new Error('WebDAV 回读探测对象删除后仍存在');
}

async function publishSnapshot(client: WebDavClient,
  input: SyncObjectAddress & { readonly expectedRevision: string | null; readonly ciphertext: Uint8Array }): Promise<SyncPublishReceipt> {
  if (input.ciphertext.length === 0) throw new Error('不能发布空的 WebDAV 快照');
  const url = snapshotUrl(client, input);
  if (client.consistencyMode === 'readback-only') {
    const current = await readObject({ client, url, label: '设备快照' });
    if ((current?.revision ?? null) !== input.expectedRevision) throw new Error('WebDAV 快照在发布前已变化');
    const response = await client.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
      body: bytesBody(input.ciphertext) });
    if (!response.ok) throw new Error(`WebDAV 发布快照失败（HTTP ${response.status}）`);
    return { revision: await writeReceiptRevision({ client, url, label: '快照发布回执', response,
      expectedBytes: input.ciphertext }) };
  }
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  headers.set(input.expectedRevision === null ? 'If-None-Match' : 'If-Match',
    input.expectedRevision === null ? '*' : validateStrongEtag(input.expectedRevision, '设备快照版本'));
  const response = await client.request(url, { method: 'PUT', headers, body: bytesBody(input.ciphertext) });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error(`WebDAV 快照条件发布冲突（HTTP ${WEBDAV_HTTP_STATUS.preconditionFailed}）`);
  if (!response.ok) throw new Error(`WebDAV 发布快照失败（HTTP ${response.status}）`);
  return { revision: await writeReceiptRevision({ client, url, label: '快照发布回执', response, expectedBytes: input.ciphertext }) };
}

function requireExistingCollection(entries: Awaited<ReturnType<typeof propfindIfPresent>>,
  url: URL, label: string): void {
  if (entries === null) throw new Error(`WebDAV collection 不存在：${url.pathname}`);
  const entry = exactWebDavEntry(entries, url);
  requireCollection(entry, label);
}

async function confirmCollection(client: WebDavClient, url: URL, label: string): Promise<void> {
  requireExistingCollection(await propfindIfPresent(client, url, '0'), url, label);
}

async function ensureCollection(client: WebDavClient, url: URL): Promise<void> {
  const existing = await propfindIfPresent(client, url, '0');
  if (existing !== null) {
    requireExistingCollection(existing, url, '已存在路径');
    return;
  }
  const response = await client.request(url, { method: 'MKCOL' });
  if (response.status === WEBDAV_HTTP_STATUS.created) return;
  if (response.status === WEBDAV_HTTP_STATUS.methodNotAllowed || response.status === WEBDAV_HTTP_STATUS.conflict) {
    await confirmCollection(client, url, '已存在路径');
    return;
  }
  throw new Error(`WebDAV 创建 collection 失败（HTTP ${response.status}）：${url.pathname}`);
}

async function prepareCollections(client: WebDavClient,
  input: { readonly vaultId: string; readonly deviceId: string }): Promise<void> {
  validateWebDavIdentity(input.vaultId, '同步库');
  validateWebDavIdentity(input.deviceId, '设备');
  if (client.autoCreateRootCollection) await ensureCollection(client, client.root);
  else await confirmCollection(client, client.root, '配置的根路径');
  await ensureCollection(client, collectionUrl(client, 'vaults'));
  const vault = collectionUrl(client, 'vaults', input.vaultId);
  await ensureCollection(client, vault);
  await Promise.all([
    ensureCollection(client, collectionUrl(client, 'vaults', input.vaultId, 'devices')),
    ensureCollection(client, collectionUrl(client, 'vaults', input.vaultId, 'assets')),
  ]);
  await ensureCollection(client, collectionUrl(client, 'vaults', input.vaultId, 'devices', input.deviceId));
}

function createObjectStore(client: WebDavClient): SyncObjectStore {
  return {
    listSnapshots: (input) => listSnapshots(client, input),
    async readSnapshot(input) {
      const object = await readObject({ client, url: snapshotUrl(client, input), label: '设备快照', revision: input.revision });
      if (!object) throw new Error('WebDAV 设备快照不存在');
      return object;
    },
    readAsset: (input) => readObject({ client, url: assetUrl(client, input), label: '媒体' }),
    createAsset: (input) => createAsset(client, input),
    publishSnapshot: (input) => publishSnapshot(client, input),
  };
}

async function readVault(client: WebDavClient): Promise<{ readonly vaultId: string; readonly ciphertext: Uint8Array } | null> {
  const response = await client.request(client.url('vault.json'), { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return null;
  if (client.isNutstore && response.status === WEBDAV_HTTP_STATUS.conflict
    && NUTSTORE_ANCESTORS_NOT_FOUND.test(await response.text())) return null;
  if (response.status !== WEBDAV_HTTP_STATUS.ok) throw new Error(`WebDAV 读取同步库描述失败（HTTP ${response.status}）`);
  const manifest = parseWebDavVaultManifest(await response.json());
  return { vaultId: manifest.vaultId, ciphertext: fromBase64(manifest.ciphertext) };
}

async function createVault(client: WebDavClient,
  input: { readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void> {
  validateWebDavIdentity(input.vaultId, '同步库');
  if (input.ciphertext.length === 0) throw new Error('不能创建空的 WebDAV 同步库密文');
  const manifest = JSON.stringify({ schemaVersion: 1, vaultId: input.vaultId, ciphertext: base64(input.ciphertext) });
  const url = client.url('vault.json');
  if (client.consistencyMode === 'readback-only' && await readVault(client)) {
    throw new Error('WebDAV 同步库描述已存在，拒绝覆盖');
  }
  const response = await client.request(url, { method: 'PUT', headers: {
    ...(client.consistencyMode === 'strong-etag' ? { 'If-None-Match': '*' } : {}),
    'Content-Type': 'application/json; charset=utf-8',
  }, body: manifest });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error('WebDAV 同步库描述已存在，拒绝覆盖');
  if (!response.ok) throw new Error(`WebDAV 创建同步库描述失败（HTTP ${response.status}）：${url.pathname}`);
  await writeReceiptRevision({ client, url, label: '同步库创建回执', response,
    expectedBytes: new TextEncoder().encode(manifest) });
  if (client.consistencyMode === 'readback-only') return;
  const published = await readVault(client);
  if (!published || published.vaultId !== input.vaultId || !equalBytes(published.ciphertext, input.ciphertext)) {
    throw new Error('WebDAV 同步库创建结果与本机内容不一致');
  }
}

export function createWebDavRemote(input: WebDavRemoteInput): WebDavRemote {
  const client = createWebDavClient(input);
  return {
    objects: createObjectStore(client),
    readVault: () => readVault(client),
    createVault: (vault) => createVault(client, vault),
    prepareCollections: (collections) => prepareCollections(client, collections),
    verifyConditions: (conditions) => verifyConditions(client, conditions),
  };
}
