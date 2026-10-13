import { validateStrongEtag, validateWebDavIdentity } from '@/domain/webdav/validation';
import type { WebDavClient } from '@/platform/webdav-client';
import { parseWebDavMultiStatus, type WebDavEntry } from '@/platform/webdav-xml';
import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>';

export async function propfind(client: WebDavClient, url: URL, depth: '0' | '1'): Promise<readonly WebDavEntry[]> {
  const response = await client.request(url, { method: 'PROPFIND', headers: {
    Depth: depth, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml, text/xml',
  }, body: PROPFIND_BODY });
  if (response.status !== WEBDAV_HTTP_STATUS.multiStatus) throw new Error(`WebDAV PROPFIND 失败（HTTP ${response.status}）`);
  return parseWebDavMultiStatus(client.parseXml(await response.text()));
}

export function hrefUrl(href: string, parent: URL): URL {
  if (!href || href.trim() !== href || /[\u0000-\u0020\u007f-\u009f\\]/.test(href)) {
    throw new Error('WebDAV PROPFIND 返回了格式无效的 href');
  }
  const url = new URL(href, parent);
  if (url.origin !== parent.origin || url.username || url.password || url.search || url.hash) {
    throw new Error('WebDAV PROPFIND 返回了越界 href');
  }
  return url;
}

export function childIdentity(href: string, parent: URL): string | null {
  const url = hrefUrl(href, parent);
  const prefix = parent.pathname.endsWith('/') ? parent.pathname : `${parent.pathname}/`;
  if (url.pathname.replace(/\/+$/, '') === parent.pathname.replace(/\/+$/, '')) return null;
  if (!url.pathname.startsWith(prefix)) throw new Error('WebDAV PROPFIND href 超出目标 collection');
  const rawSegment = url.pathname.slice(prefix.length).replace(/\/$/, '');
  if (!rawSegment || rawSegment.includes('/')) throw new Error('WebDAV PROPFIND href 不是直接子项');
  let identity: string;
  try {
    identity = decodeURIComponent(rawSegment);
  } catch (cause) {
    throw new Error('WebDAV PROPFIND href 编码无效', { cause });
  }
  return validateWebDavIdentity(identity, '设备');
}

export async function strongRevision(response: Response, label: string): Promise<string> {
  return validateStrongEtag(response.headers.get('ETag'), label);
}

export function entryRevision(entry: WebDavEntry, label: string): string {
  if (entry.etagStatus === null || entry.etagStatus < WEBDAV_HTTP_STATUS.successMin
    || entry.etagStatus >= WEBDAV_HTTP_STATUS.redirectMin) {
    throw new Error(`${label}的 getetag 属性查询未成功`);
  }
  return validateStrongEtag(entry.etag, label);
}

export function requireCollection(entry: WebDavEntry, label: string): void {
  if (entry.resourceTypeStatus === null || entry.resourceTypeStatus < WEBDAV_HTTP_STATUS.successMin
    || entry.resourceTypeStatus >= WEBDAV_HTTP_STATUS.redirectMin
    || entry.collection !== true) throw new Error(`${label}不是可确认的 WebDAV collection`);
}

export function requireNonCollection(entry: WebDavEntry, label: string): void {
  if (entry.resourceTypeStatus === null || entry.resourceTypeStatus < WEBDAV_HTTP_STATUS.successMin
    || entry.resourceTypeStatus >= WEBDAV_HTTP_STATUS.redirectMin
    || entry.collection !== false) throw new Error(`${label}缺少有效 resourcetype 属性或意外指向 collection`);
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch (cause) {
    throw new Error('WebDAV 同步库密文不是有效 Base64', { cause });
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length === 0 || base64(bytes) !== value) throw new Error('WebDAV 同步库密文不是规范 Base64');
  return bytes;
}
