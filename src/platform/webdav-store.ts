import { parseWebDavVaultManifest, validateStrongEtag, validateWebDavIdentity } from '@/domain/webdav/validation';
import type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';
import type { SyncObjectStore } from '@/sync/objects';
import { createWebDavClient, type WebDavInput, type WebDavClient } from '@/platform/webdav-client';
import { base64, childIdentity, entryRevision, fromBase64, hrefUrl, propfind, requireCollection,
  requireNonCollection, strongRevision } from '@/platform/webdav-protocol';
import { parseWebDavMultiStatus } from '@/platform/webdav-xml';
import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';

export type WebDavRemoteInput = WebDavInput;

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

function exactEntry(entries: Awaited<ReturnType<typeof propfind>>, expected: URL) {
  const matches = entries.filter((entry) => {
    const actual = hrefUrl(entry.href, expected);
    return actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
  });
  if (matches.length !== 1) throw new Error('WebDAV PROPFIND 未返回唯一的目标资源');
  return matches[0]!;
}

interface ReadObjectInput {
  readonly client: WebDavClient;
  readonly url: URL;
  readonly label: string;
  readonly revision?: string;
}

async function readObject(input: ReadObjectInput): Promise<SyncObjectRead | null> {
  const headers = input.revision === undefined ? undefined : { 'If-Match': validateStrongEtag(input.revision, '对象版本') };
  const response = await input.client.request(input.url, { method: 'GET', headers });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return null;
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error(`WebDAV ${input.label}版本已变化`);
  if (response.status !== WEBDAV_HTTP_STATUS.ok) throw new Error(`WebDAV 读取${input.label}失败（HTTP ${response.status}）`);
  const etag = await strongRevision(response, input.label);
  if (input.revision && etag !== input.revision) throw new Error(`WebDAV ${input.label}返回版本与 If-Match 不一致`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.length === 0) throw new Error(`WebDAV ${input.label}内容为空`);
  return { revision: etag, ciphertext };
}

async function snapshotRevision(client: WebDavClient, url: URL): Promise<string | null> {
  const response = await client.request(url, { method: 'PROPFIND', headers: {
    Depth: '0', 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml, text/xml',
  }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>' });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return null;
  if (response.status !== WEBDAV_HTTP_STATUS.multiStatus) throw new Error(`WebDAV 快照版本查询失败（HTTP ${response.status}）`);
  const entries = parseWebDavMultiStatus(client.parseXml(await response.text()));
  const entry = exactEntry(entries, url);
  requireNonCollection(entry, '设备快照');
  return entryRevision(entry, '设备快照');
}

async function listSnapshots(client: WebDavClient, input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]> {
  validateWebDavIdentity(input.vaultId, '同步库');
  const collection = collectionUrl(client, 'vaults', input.vaultId, 'devices');
  const entries = await propfind(client, collection, '1');
  const heads: SyncSnapshotHead[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const deviceId = childIdentity(entry.href, collection);
    if (deviceId === null) continue;
    requireCollection(entry, 'devices 子项');
    if (seen.has(deviceId)) throw new Error(`WebDAV 设备路径重复：${deviceId}`);
    seen.add(deviceId);
    const revision = await snapshotRevision(client, snapshotUrl(client, { vaultId: input.vaultId, objectId: deviceId }));
    if (revision !== null) heads.push({ deviceId, revision });
  }
  return heads.toSorted((left, right) => left.deviceId < right.deviceId ? -1 : Number(left.deviceId !== right.deviceId));
}

async function createAsset(client: WebDavClient, input: SyncObjectAddress & { readonly ciphertext: Uint8Array }): Promise<SyncAssetReceipt> {
  if (input.ciphertext.length === 0) throw new Error('不能上传空的 WebDAV 媒体对象');
  const response = await client.request(assetUrl(client, input), { method: 'PUT', headers: {
    'If-None-Match': '*', 'Content-Type': 'application/octet-stream',
  }, body: bytesBody(input.ciphertext) });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) {
    const existing = await readObject({ client, url: assetUrl(client, input), label: '媒体' });
    if (!existing) throw new Error('WebDAV 媒体条件竞争后对象不存在');
    return { created: false, revision: existing.revision };
  }
  if (!response.ok) throw new Error(`WebDAV 创建媒体失败（HTTP ${response.status}）`);
  return { created: true, revision: await strongRevision(response, '媒体创建回执') };
}

function bytesBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function appendByte(bytes: Uint8Array, value: number): Uint8Array {
  const result = new Uint8Array(bytes.length + 1);
  result.set(bytes);
  result[bytes.length] = value;
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
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
  const revision = await strongRevision(created, '条件探测创建回执');
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
  const url = client.url('vaults', input.vaultId, `probe-${input.deviceId}.enc`);
  const probe = new TextEncoder().encode(`Orinui WebDAV condition probe v1:${input.vaultId}:${input.deviceId}`);
  try {
    await runConditionProbe(client, url, probe);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`WebDAV 条件能力验证失败：${detail}；诊断对象可能保留在 ${url.pathname}`, { cause });
  }
}

async function publishSnapshot(client: WebDavClient,
  input: SyncObjectAddress & { readonly expectedRevision: string | null; readonly ciphertext: Uint8Array }): Promise<SyncPublishReceipt> {
  if (input.ciphertext.length === 0) throw new Error('不能发布空的 WebDAV 快照');
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  headers.set(input.expectedRevision === null ? 'If-None-Match' : 'If-Match',
    input.expectedRevision === null ? '*' : validateStrongEtag(input.expectedRevision, '设备快照版本'));
  const response = await client.request(snapshotUrl(client, input), { method: 'PUT', headers, body: bytesBody(input.ciphertext) });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error(`WebDAV 快照条件发布冲突（HTTP ${WEBDAV_HTTP_STATUS.preconditionFailed}）`);
  if (!response.ok) throw new Error(`WebDAV 发布快照失败（HTTP ${response.status}）`);
  return { revision: await strongRevision(response, '快照发布回执') };
}

async function ensureCollection(client: WebDavClient, url: URL): Promise<void> {
  const response = await client.request(url, { method: 'MKCOL' });
  if (response.status === WEBDAV_HTTP_STATUS.created) return;
  if (response.status !== WEBDAV_HTTP_STATUS.methodNotAllowed) throw new Error(`WebDAV 创建 collection 失败（HTTP ${response.status}）`);
  const entry = exactEntry(await propfind(client, url, '0'), url);
  requireCollection(entry, '已存在路径');
}

async function prepareCollections(client: WebDavClient,
  input: { readonly vaultId: string; readonly deviceId: string }): Promise<void> {
  validateWebDavIdentity(input.vaultId, '同步库');
  validateWebDavIdentity(input.deviceId, '设备');
  const paths = [client.root, collectionUrl(client, 'vaults'), collectionUrl(client, 'vaults', input.vaultId),
    collectionUrl(client, 'vaults', input.vaultId, 'devices'),
    collectionUrl(client, 'vaults', input.vaultId, 'devices', input.deviceId),
    collectionUrl(client, 'vaults', input.vaultId, 'assets')];
  for (const path of paths) await ensureCollection(client, path);
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
  if (response.status !== WEBDAV_HTTP_STATUS.ok) throw new Error(`WebDAV 读取同步库描述失败（HTTP ${response.status}）`);
  const manifest = parseWebDavVaultManifest(await response.json());
  return { vaultId: manifest.vaultId, ciphertext: fromBase64(manifest.ciphertext) };
}

async function createVault(client: WebDavClient,
  input: { readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void> {
  validateWebDavIdentity(input.vaultId, '同步库');
  if (input.ciphertext.length === 0) throw new Error('不能创建空的 WebDAV 同步库密文');
  const manifest = JSON.stringify({ schemaVersion: 1, vaultId: input.vaultId, ciphertext: base64(input.ciphertext) });
  const response = await client.request(client.url('vault.json'), { method: 'PUT', headers: {
    'If-None-Match': '*', 'Content-Type': 'application/json; charset=utf-8',
  }, body: manifest });
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error('WebDAV 同步库描述已存在，拒绝覆盖');
  if (!response.ok) throw new Error(`WebDAV 创建同步库描述失败（HTTP ${response.status}）`);
  await strongRevision(response, '同步库创建回执');
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
