import { createWebDavRemote } from '@/platform/webdav-store';
import type { WebDavConsistencyMode } from '@/domain/webdav/configuration';

interface SetupOptions {
  readonly url?: string;
  readonly consistencyMode?: WebDavConsistencyMode;
}

interface TestElement {
  readonly localName: string;
  readonly namespaceURI: string;
  readonly children: readonly TestElement[];
  readonly textContent: string;
}

interface ElementOptions {
  readonly children?: readonly TestElement[];
  readonly textContent?: string;
  readonly namespaceURI?: string;
}

export function element(localName: string, options: ElementOptions = {}): TestElement {
  return { localName, namespaceURI: options.namespaceURI ?? 'DAV:', children: options.children ?? [], textContent: options.textContent ?? '' };
}

function statusText(status: number): string {
  return `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Not Found'}`;
}

function propstat(properties: readonly TestElement[], status: number): TestElement {
  return element('propstat', { children: [element('prop', { children: properties }),
    element('status', { textContent: statusText(status) })] });
}

function hasEtag(options: NonNullable<Parameters<typeof propstats>[0]>): boolean {
  return options.etag !== undefined || options.etagStatus !== undefined;
}

function makeEtag(options: NonNullable<Parameters<typeof propstats>[0]>): TestElement {
  return element('getetag', { textContent: options.etag ?? '' });
}

function propstats(options: { readonly collection?: boolean; readonly etag?: string; readonly status?: number;
  readonly resourceTypeStatus?: number; readonly etagStatus?: number } = {}): readonly TestElement[] {
  const resourceStatus = options.resourceTypeStatus ?? options.status ?? 200;
  const etagStatus = options.etagStatus ?? options.status ?? 200;
  const resourceType = element('resourcetype', { children: options.collection ? [element('collection')] : [] });
  if (!hasEtag(options)) return [propstat([resourceType], resourceStatus)];
  if (etagStatus === resourceStatus) return [propstat([resourceType, makeEtag(options)], resourceStatus)];
  return [propstat([resourceType], resourceStatus), propstat([makeEtag(options)], etagStatus)];
}

export function response(href: string, options: Parameters<typeof propstats>[0] = {}): TestElement {
  return element('response', { children: [element('href', { textContent: href }), ...propstats(options)] });
}

export function documentFor(responses: readonly TestElement[]): Document {
  const root = element('multistatus', { children: responses });
  return { documentElement: root, getElementsByTagName: () => [] } as unknown as Document;
}

export function xmlFor(...responses: readonly TestElement[]): string {
  return JSON.stringify(responses);
}

export function setup(handler: (url: URL, init: RequestInit) => Response | Promise<Response>, options: SetupOptions = {}) {
  const documents = new Map<string, Document>();
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(input.toString()), init);
  const parseXml = (source: string) => documents.get(source) ?? documentFor(JSON.parse(source) as TestElement[]);
  const remote = createWebDavRemote({
    credentials: { url: options.url ?? 'https://dav.example.test/orinui/', username: '用户', password: 'pāss' },
    ...(options.consistencyMode ? { consistencyMode: options.consistencyMode } : {}),
    fetch: fetch as typeof globalThis.fetch,
    parseXml,
  });
  return { remote, documents };
}

export function ok(body = '', status = 200, headers?: HeadersInit): Response {
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

function readProbe(path: string, headers: Headers, stored: Map<string, Uint8Array>): Response {
  const body = stored.get(path);
  if (!body) return ok('', 404);
  if (headers.has('If-Match') && headers.get('If-Match') !== '"probe-r1"') return ok('', 412);
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return new Response(copy, { status: 200, headers: { ETag: '"probe-r1"' } });
}

function writeProbe(input: { readonly path: string; readonly init: RequestInit;
  readonly headers: Headers; readonly stored: Map<string, Uint8Array> }): Response {
  const { path, init, headers, stored } = input;
  if (headers.has('If-None-Match') && stored.has(path)) return ok('', 412);
  if (headers.has('If-Match') && headers.get('If-Match') !== '"probe-r1"') return ok('', 412);
  stored.set(path, new Uint8Array(init.body as ArrayBuffer));
  return ok('', 201, { ETag: '"probe-r1"' });
}

function deleteProbe(path: string, headers: Headers, stored: Map<string, Uint8Array>): Response {
  if (headers.get('If-Match') !== '"probe-r1"' || !stored.has(path)) return ok('', 412);
  stored.delete(path);
  return ok('', 204);
}

export function conditionProbeHandler(stored: Map<string, Uint8Array>, calls: string[]) {
  let probePath = '';
  return (url: URL, init: RequestInit): Response => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push(`${method} ${headers.get('If-None-Match') ?? headers.get('If-Match') ?? '-'}`);
    if (method === 'PROPFIND') {
      if (url.pathname === '/orinui/') return ok(xmlFor(response(url.pathname, { collection: true })), 207);
      if (url.pathname === probePath && stored.has(probePath)) {
        return ok(xmlFor(response(url.pathname, { collection: false, etag: '"probe-r1"' })), 207);
      }
      return ok('', 404);
    }
    if (method === 'MKCOL') return ok('', 201);
    if (method === 'PUT') {
      probePath = url.pathname;
      return writeProbe({ path: probePath, init, headers, stored });
    }
    if (url.pathname !== probePath) throw new Error(`unexpected ${method} ${url.pathname}`);
    if (method === 'GET') return readProbe(probePath, headers, stored);
    if (method === 'DELETE') return deleteProbe(probePath, headers, stored);
    throw new Error(`unexpected ${method} ${url.pathname}`);
  };
}
