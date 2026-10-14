import { validateStrongEtag } from '@/domain/webdav/validation';
import type { SyncObjectRead } from '@/domain/sync/object-types';
import type { WebDavClient } from '@/platform/webdav-client';
import { entryRevision, hrefUrl, propfindIfPresent, requireNonCollection, strongRevision } from '@/platform/webdav-protocol';
import type { WebDavEntry } from '@/platform/webdav-xml';
import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';
import type { WebDavConsistencyMode } from '@/domain/webdav/configuration';

export function exactWebDavEntry(entries: readonly WebDavEntry[], expected: URL): WebDavEntry {
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
  readonly consistencyMode?: WebDavConsistencyMode;
  readonly revision?: string;
}

async function readObjectByDigest(input: ReadObjectInput): Promise<SyncObjectRead | null> {
  const response = await input.client.request(input.url, { method: 'GET' });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return null;
  if (response.status !== WEBDAV_HTTP_STATUS.ok) throw new Error(`WebDAV 读取${input.label}失败（HTTP ${response.status}）`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.length === 0) throw new Error(`WebDAV ${input.label}内容为空`);
  const digest = await crypto.subtle.digest('SHA-256', ciphertext);
  const revision = `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (input.revision && revision !== input.revision) throw new Error(`WebDAV ${input.label}版本已变化`);
  return { revision, ciphertext };
}

interface ResourceRevisionInput {
  readonly client: WebDavClient;
  readonly url: URL;
  readonly label: string;
  readonly responseProblem: string;
}

async function requireResourceRevision(input: ResourceRevisionInput): Promise<string> {
  try {
    const revision = await readResourceRevision(input.client, input.url, input.label);
    if (revision === null) throw new Error(`目标资源不存在：${input.url.pathname}`);
    return revision;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`WebDAV ${input.label}响应 ETag 无效（${input.responseProblem}），DAV:getetag/GET 均无法确认强 ETag：${detail}`, { cause });
  }
}

export async function readObject(input: ReadObjectInput): Promise<SyncObjectRead | null> {
  if ((input.consistencyMode ?? input.client.consistencyMode) === 'readback-only') return readObjectByDigest(input);
  const headers = input.revision === undefined ? undefined : { 'If-Match': validateStrongEtag(input.revision, '对象版本') };
  const response = await input.client.request(input.url, { method: 'GET', headers });
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return null;
  if (response.status === WEBDAV_HTTP_STATUS.preconditionFailed) throw new Error(`WebDAV ${input.label}版本已变化`);
  if (response.status !== WEBDAV_HTTP_STATUS.ok) throw new Error(`WebDAV 读取${input.label}失败（HTTP ${response.status}）`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.length === 0) throw new Error(`WebDAV ${input.label}内容为空`);
  let revision: string | null = null;
  let responseProblem = '响应未包含 ETag';
  if (response.headers.get('ETag') !== null) {
    try {
      revision = await strongRevision(response, input.label);
    } catch (cause) {
      responseProblem = cause instanceof Error ? cause.message : String(cause);
    }
  }
  if (revision !== null) {
    if (input.revision && revision !== input.revision) throw new Error(`WebDAV ${input.label}返回版本与 If-Match 不一致`);
    return { revision, ciphertext };
  }
  const observedRevision = await requireResourceRevision({ client: input.client, url: input.url,
    label: input.label, responseProblem });
  if (input.revision && observedRevision !== input.revision) throw new Error(`WebDAV ${input.label}版本已变化`);
  if (input.revision) return { revision: observedRevision, ciphertext };
  const verified = await readObject({ ...input, revision: observedRevision });
  if (!verified || !equalBytes(verified.ciphertext, ciphertext)) throw new Error(`WebDAV ${input.label}条件读取内容与初次读取不一致`);
  return verified;
}

export async function readResourceRevision(client: WebDavClient, url: URL, label: string): Promise<string | null> {
  if (client.consistencyMode === 'readback-only') {
    return (await readObject({ client, url, label, consistencyMode: 'readback-only' }))?.revision ?? null;
  }
  const entries = await propfindIfPresent(client, url, '0');
  if (entries === null) return null;
  const entry = exactWebDavEntry(entries, url);
  requireNonCollection(entry, label);
  try {
    return entryRevision(entry, label);
  } catch (propertyCause) {
    try {
      const response = await client.request(url, { method: 'GET' });
      if (response.status !== WEBDAV_HTTP_STATUS.ok) {
        throw new Error(`WebDAV ${label}版本 GET 查询失败（HTTP ${response.status}）：${url.pathname}`);
      }
      return await strongRevision(response, label);
    } catch (getCause) {
      const propertyDetail = propertyCause instanceof Error ? propertyCause.message : String(propertyCause);
      const getDetail = getCause instanceof Error ? getCause.message : String(getCause);
      throw new Error(`WebDAV ${label}无法从 DAV:getetag 或 GET 获取有效强 ETag：${propertyDetail}；${getDetail}`, { cause: getCause });
    }
  }
}

export function bytesBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

interface WriteReceiptInput {
  readonly client: WebDavClient;
  readonly url: URL;
  readonly label: string;
  readonly response: Response;
  readonly expectedBytes: Uint8Array;
}

export async function writeReceiptRevision(input: WriteReceiptInput): Promise<string> {
  if (input.client.consistencyMode === 'readback-only') {
    const verified = await readObject({ client: input.client, url: input.url, label: input.label });
    if (!verified || !equalBytes(verified.ciphertext, input.expectedBytes)) {
      throw new Error(`WebDAV ${input.label} SHA-256 回读内容与写入不一致`);
    }
    return verified.revision;
  }
  let responseProblem = '响应未包含 ETag';
  if (input.response.headers.get('ETag') !== null) {
    try {
      return await strongRevision(input.response, input.label);
    } catch (cause) {
      responseProblem = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const revision = await requireResourceRevision({ client: input.client, url: input.url,
    label: input.label, responseProblem });
  const verified = await readObject({ client: input.client, url: input.url, label: input.label, revision });
  if (!verified || !equalBytes(verified.ciphertext, input.expectedBytes)) {
    throw new Error(`WebDAV ${input.label}条件回读内容与写入不一致`);
  }
  return revision;
}
