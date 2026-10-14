import { parseWebDavVaultManifest, validateWebDavIdentity } from '@/domain/webdav/validation';
import type { WebDavClient } from '@/platform/webdav-client';
import { WEBDAV_HTTP_STATUS, isMissingWebDavDescriptor } from '@/platform/webdav-http';
import { propfindIfPresent } from '@/platform/webdav-protocol';
import { readObject } from '@/platform/webdav-resource';

async function readDescriptor(client: WebDavClient, url: URL) {
  const response = await client.request(url, { method: 'GET' });
  if (await isMissingWebDavDescriptor(response, client.isNutstore)) return null;
  if (response.status !== WEBDAV_HTTP_STATUS.ok) {
    throw new Error(`WebDAV 读取同步库描述失败（HTTP ${response.status}）：${url.pathname}`);
  }
  return readObject({ client, url, label: '同步库描述' });
}

async function deleteResource(input: { readonly client: WebDavClient; readonly url: URL;
  readonly revision?: string }): Promise<void> {
  const response = await input.client.request(input.url, { method: 'DELETE',
    headers: input.revision ? { 'If-Match': input.revision } : undefined });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return;
  if (!response.ok || response.status === WEBDAV_HTTP_STATUS.multiStatus) {
    throw new Error(`WebDAV 删除失败（HTTP ${response.status}）：${input.url.pathname}；远端数据可能已部分删除，请重试`);
  }
}

async function deleteDescriptor(input: { readonly client: WebDavClient; readonly url: URL;
  readonly revision: string }): Promise<void> {
  const observed = await readDescriptor(input.client, input.url);
  if (!observed) return;
  if (observed.revision !== input.revision) throw new Error('远端同步库描述已变化，拒绝删除');
  await deleteResource({ client: input.client, url: input.url,
    ...(input.client.consistencyMode === 'strong-etag' ? { revision: input.revision } : {}) });
}

/** Keep the descriptor until media cleanup finishes so an interrupted deletion can be retried. */
export async function deleteWebDavVault(client: WebDavClient, vaultId: string): Promise<void> {
  validateWebDavIdentity(vaultId, '同步库');
  const descriptor = client.url('vault.json');
  const current = await readDescriptor(client, descriptor);
  if (current && parseWebDavVaultManifest(JSON.parse(new TextDecoder().decode(current.ciphertext))).vaultId !== vaultId) {
    throw new Error('远端同步库身份已变化，拒绝删除');
  }
  const collection = client.url('vaults', vaultId);
  collection.pathname += '/';
  await deleteResource({ client, url: collection });
  if (await propfindIfPresent(client, collection, '0') !== null) {
    throw new Error(`WebDAV 删除后同步库目录仍存在：${collection.pathname}`);
  }
  if (current) {
    await deleteDescriptor({ client, url: descriptor, revision: current.revision });
  }
  if (await readDescriptor(client, descriptor)) {
    throw new Error('WebDAV 删除后同步库描述仍存在');
  }
  if (await propfindIfPresent(client, collection, '0') !== null) {
    throw new Error('WebDAV 删除期间同步库目录被重新写入，请停止其他设备同步后重试');
  }
}
