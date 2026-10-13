import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';

const DAV_NAMESPACE = 'DAV:';

export interface WebDavEntry {
  readonly href: string;
  readonly collection: boolean | null;
  readonly resourceTypeStatus: number | null;
  readonly etagStatus: number | null;
  readonly etag: string | null;
}

function children(element: Element, name: string): readonly Element[] {
  return Array.from(element.children).filter((child) => child.namespaceURI === DAV_NAMESPACE && child.localName === name);
}

function oneChild(element: Element, name: string): Element {
  const matches = children(element, name);
  if (matches.length !== 1) throw new Error(`WebDAV XML 缺少唯一的 ${name} 元素`);
  return matches[0]!;
}

function parseStatus(value: string): number {
  const match = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(value.trim());
  if (!match) throw new Error('WebDAV XML propstat status 无效');
  return Number(match[1]);
}

function propertyValue(prop: Element, name: string): Element | undefined {
  const matches = children(prop, name);
  if (matches.length > 1) throw new Error('WebDAV XML 属性重复');
  return matches[0];
}

function parseResourceType(prop: Element, status: number): Pick<WebDavEntry, 'collection' | 'resourceTypeStatus'> {
  const resourceType = propertyValue(prop, 'resourcetype');
  if (!resourceType) return { collection: null, resourceTypeStatus: null };
  const collection = children(resourceType, 'collection');
  if (collection.length > 1) throw new Error('WebDAV XML collection 属性重复');
  return { collection: isSuccess(status) ? collection.length === 1 : null,
    resourceTypeStatus: status };
}

function parseEtag(prop: Element, status: number): Pick<WebDavEntry, 'etagStatus' | 'etag'> {
  const etag = propertyValue(prop, 'getetag');
  return { etagStatus: etag ? status : null,
    etag: isSuccess(status) ? etag?.textContent?.trim() || null : null };
}

function isSuccess(status: number): boolean {
  return status >= WEBDAV_HTTP_STATUS.successMin && status < WEBDAV_HTTP_STATUS.redirectMin;
}

function parseProperty(prop: Element, status: number): Pick<WebDavEntry, 'collection' | 'resourceTypeStatus' | 'etagStatus' | 'etag'> {
  return { ...parseResourceType(prop, status), ...parseEtag(prop, status) };
}

function parseResponse(response: Element): WebDavEntry {
  const href = oneChild(response, 'href').textContent?.trim();
  if (!href) throw new Error('WebDAV XML 响应缺少 href');
  const propstats = children(response, 'propstat');
  if (propstats.length === 0) throw new Error('WebDAV XML 响应缺少 propstat');
  let collection: boolean | null = null;
  let resourceTypeStatus: number | null = null;
  let etagStatus: number | null = null;
  let etag: string | null = null;
  for (const propstat of propstats) {
    const status = parseStatus(oneChild(propstat, 'status').textContent ?? '');
    const parsed = parseProperty(oneChild(propstat, 'prop'), status);
    if (parsed.resourceTypeStatus !== null) {
      if (resourceTypeStatus !== null) throw new Error('WebDAV XML resourcetype 状态重复');
      resourceTypeStatus = parsed.resourceTypeStatus;
      collection = parsed.collection;
    }
    if (parsed.etagStatus !== null) {
      if (etagStatus !== null) throw new Error('WebDAV XML getetag 状态重复');
      etagStatus = parsed.etagStatus;
      etag = parsed.etag;
    }
  }
  return { href, collection, resourceTypeStatus, etagStatus, etag };
}

export function parseWebDavMultiStatus(document: Document): readonly WebDavEntry[] {
  const root = document.documentElement;
  if (document.getElementsByTagName('parsererror').length > 0
    || root?.namespaceURI !== DAV_NAMESPACE || root.localName !== 'multistatus') {
    throw new Error('WebDAV 返回的 XML 不是有效的 DAV multistatus');
  }
  return children(root, 'response').map(parseResponse);
}
