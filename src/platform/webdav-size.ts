import { validateWebDavIdentity } from '@/domain/webdav/validation';
import type { SyncObjectProgress } from '@/domain/sync/object-types';
import type { WebDavClient } from '@/platform/webdav-client';
import type { WebDavEntry } from '@/platform/webdav-xml';
import { hrefUrl, propfind, requireNonCollection } from '@/platform/webdav-protocol';
import { readObjectMetadata } from '@/platform/webdav-resource';

async function collectionSize(input: { readonly client: WebDavClient; readonly root: URL;
  readonly onProgress?: SyncObjectProgress }): Promise<number> {
  const queue = [input.root];
  const visited = new Set<string>();
  const rootPath = input.root.pathname.replace(/\/+$/, '');
  let total = 0;
  let checked = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    if (visited.has(current.pathname)) throw new Error('WebDAV 远端 collection 路径重复');
    visited.add(current.pathname);
    const entries = await propfind(input.client, current, '1');
    for (const entry of entries) {
      const resource = hrefUrl(entry.href, current);
      const path = resource.pathname.replace(/\/+$/, '');
      if (path === current.pathname.replace(/\/+$/, '')) continue;
      if (!path.startsWith(`${rootPath}/`)) throw new Error('WebDAV 远端大小列表越出当前同步库');
      if (entry.collection === true) { resource.pathname = `${path}/`; queue.push(resource); continue; }
      total = await addResourceSize({ client: input.client, entry, resource, total });
      checked += 1;
      input.onProgress?.(checked);
    }
  }
  return total;
}

async function addResourceSize(input: { readonly client: WebDavClient; readonly entry: WebDavEntry;
  readonly resource: URL; readonly total: number }): Promise<number> {
  requireNonCollection(input.entry, '同步库对象');
  const metadata = await readObjectMetadata(input.client, input.resource, '同步库对象');
  if (!metadata) throw new Error(`WebDAV 对象在容量统计期间消失：${input.resource.pathname}`);
  const sum = input.total + metadata.ciphertextBytes;
  if (!Number.isSafeInteger(sum)) throw new Error('WebDAV 远端同步库总大小超出可计量范围');
  return sum;
}

export async function measureWebDavVaultBytes(input: { readonly client: WebDavClient; readonly vaultId: string;
  readonly onProgress?: SyncObjectProgress }): Promise<number> {
  validateWebDavIdentity(input.vaultId, '同步库');
  const descriptor = await readObjectMetadata(input.client, input.client.url('vault.json'), '同步库描述');
  const descriptorCount = Number(descriptor !== null);
  if (descriptorCount) input.onProgress?.(descriptorCount);
  const root = input.client.url('vaults', input.vaultId);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  const vaultBytes = await collectionSize({ client: input.client, root, onProgress: (count) => input.onProgress?.(count + descriptorCount) });
  const total = vaultBytes + (descriptor?.ciphertextBytes ?? 0);
  if (!Number.isSafeInteger(total)) throw new Error('WebDAV 远端同步库总大小超出可计量范围');
  return total;
}
