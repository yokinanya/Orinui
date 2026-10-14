import { parseWebDavCredentials, validateWebDavIdentity } from '@/domain/webdav/validation';
import type { WebDavConsistencyMode } from '@/domain/webdav/configuration';
import { WEBDAV_HTTP_STATUS } from '@/platform/webdav-http';

const DAV_ENDPOINT_ROOT = /(?:^|\/)dav\/$/;
const APP_COLLECTION_NAME = 'Orinui';
const NUTSTORE_ORIGIN = 'https://dav.jianguoyun.com';

export interface WebDavInput {
  readonly credentials: { readonly url: string; readonly username: string; readonly password: string };
  readonly consistencyMode?: WebDavConsistencyMode;
  readonly fetch: typeof fetch;
  readonly parseXml: (source: string) => Document;
}


export interface WebDavClient {
  readonly root: URL;
  readonly isNutstore: boolean;
  readonly consistencyMode: WebDavConsistencyMode;
  readonly autoCreateRootCollection: boolean;
  readonly parseXml: WebDavInput['parseXml'];
  url(...segments: readonly string[]): URL;
  request(url: URL, init?: RequestInit): Promise<Response>;
}

function encodeCredentials(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function createWebDavClient(input: WebDavInput): WebDavClient {
  const credentials = parseWebDavCredentials(input.credentials);
  const root = new URL(credentials.url);
  const consistencyMode = input.consistencyMode ?? 'strong-etag';
  const isNutstore = root.origin === NUTSTORE_ORIGIN;
  const isDavEndpointRoot = DAV_ENDPOINT_ROOT.test(root.pathname);
  if (isDavEndpointRoot) {
    root.pathname = `${root.pathname}${APP_COLLECTION_NAME}/`;
  }
  // A bare /dav endpoint uses an app-specific collection to avoid writing into the service root.
  const autoCreateRootCollection = isDavEndpointRoot;
  const authorization = encodeCredentials(credentials.username, credentials.password);
  return {
    root,
    isNutstore,
    consistencyMode,
    autoCreateRootCollection,
    parseXml: input.parseXml,
    url(...segments) {
      const path = segments.map((segment) => encodeURIComponent(validateWebDavIdentity(segment, '路径'))).join('/');
      return new URL(path, root);
    },
    async request(url, init = {}) {
      if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)
        || url.username || url.password || url.search || url.hash) {
        throw new Error('WebDAV 请求地址超出配置的根 collection');
      }
      const headers = new Headers(init.headers);
      headers.set('Authorization', authorization);
      const response = await input.fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (response.redirected || (response.status >= WEBDAV_HTTP_STATUS.redirectMin
        && response.status < WEBDAV_HTTP_STATUS.redirectMax)) {
        throw new Error('WebDAV 服务返回了重定向，已拒绝转发认证信息');
      }
      return response;
    },
  };
}
