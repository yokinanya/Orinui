import { expect, it } from 'vitest';

import { parseWebDavMultiStatus } from '@/platform/webdav-xml';
import { createWebDavRemote } from '@/platform/webdav-store';

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

function element(localName: string, options: ElementOptions = {}): TestElement {
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
  if (etagStatus === resourceStatus) {
    const properties = [resourceType, makeEtag(options)];
    return [propstat(properties, resourceStatus)];
  }
  return [propstat([resourceType], resourceStatus), propstat([makeEtag(options)], etagStatus)];
}

function response(href: string, options: Parameters<typeof propstats>[0] = {}): TestElement {
  return element('response', { children: [element('href', { textContent: href }), ...propstats(options)] });
}

function documentFor(responses: readonly TestElement[]): Document {
  const root = element('multistatus', { children: responses });
  return { documentElement: root, getElementsByTagName: () => [] } as unknown as Document;
}

function xmlFor(...responses: readonly TestElement[]): string {
  return JSON.stringify(responses);
}

function setup(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const documents = new Map<string, Document>();
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(input.toString()), init);
  const parseXml = (source: string) => documents.get(source) ?? documentFor(JSON.parse(source) as TestElement[]);
  const remote = createWebDavRemote({
    credentials: { url: 'https://dav.example.test/orinui/', username: '用户', password: 'pāss' },
    fetch: fetch as typeof globalThis.fetch,
    parseXml,
  });
  return { remote, documents };
}

function ok(body = '', status = 200, headers?: HeadersInit) {
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

function conditionProbeHandler(probePath: string, stored: Map<string, Uint8Array>, calls: string[]) {
  return (url: URL, init: RequestInit): Response => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push(`${method} ${headers.get('If-None-Match') ?? headers.get('If-Match') ?? '-'}`);
    if (method === 'MKCOL') return ok('', 201);
    if (url.pathname !== probePath) throw new Error(`unexpected ${method} ${url.pathname}`);
    if (method === 'PUT') return writeProbe({ path: probePath, init, headers, stored });
    if (method === 'GET') return readProbe(probePath, headers, stored);
    if (method === 'DELETE') return deleteProbe(probePath, headers, stored);
    throw new Error(`unexpected ${method} ${url.pathname}`);
  };
}

it('rejects insecure or ambiguous collection URLs and unsafe path identities', async () => {
    expect(() => createWebDavRemote({ credentials: { url: 'http://dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://u:p@dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://@dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://dav.test/root/?x=1', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    const { remote } = setup(() => ok());
    expect(() => remote.objects.readAsset({ vaultId: '..', objectId: 'x' })).toThrow(/路径段/);
});

it('sends Basic UTF-8 authorization and rejects redirected responses', async () => {
    let captured: RequestInit | undefined;
    const { remote } = setup((_url, init) => { captured = init; return ok('', 302, { Location: 'https://elsewhere.test/' }); });
    await expect(remote.readVault()).rejects.toThrow(/重定向/);
    expect(captured?.redirect).toBe('error');
    expect(captured?.credentials).toBe('omit');
    expect(new Headers(captured?.headers).get('Authorization')).toBe(`Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('用户:pāss')))}`);
  });

it('prepares parent collections in order, creating only the configured hierarchy', async () => {
    const urls: string[] = [];
    const { remote } = setup((url, init) => { urls.push(`${init.method} ${url.pathname}`); return ok('', 201); });
    await remote.prepareCollections({ vaultId: 'vault-1', deviceId: 'device-1' });
    expect(urls).toEqual([
      'MKCOL /orinui/', 'MKCOL /orinui/vaults/', 'MKCOL /orinui/vaults/vault-1/',
      'MKCOL /orinui/vaults/vault-1/devices/', 'MKCOL /orinui/vaults/vault-1/devices/device-1/',
      'MKCOL /orinui/vaults/vault-1/assets/',
    ]);
  });

it('confirms an existing collection from resourcetype when getetag is unavailable', async () => {
    const methods: string[] = [];
    const { remote } = setup((url, init) => {
      methods.push(`${init.method} ${url.pathname}`);
      if (init.method === 'MKCOL') return ok('', 405);
      return ok(xmlFor(response(url.pathname, { collection: true, resourceTypeStatus: 200, etagStatus: 404 })), 207);
    });
    await remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' });
    expect(methods).toEqual([
      'MKCOL /orinui/', 'PROPFIND /orinui/', 'MKCOL /orinui/vaults/', 'PROPFIND /orinui/vaults/',
      'MKCOL /orinui/vaults/v1/', 'PROPFIND /orinui/vaults/v1/', 'MKCOL /orinui/vaults/v1/devices/',
      'PROPFIND /orinui/vaults/v1/devices/', 'MKCOL /orinui/vaults/v1/devices/d1/',
      'PROPFIND /orinui/vaults/v1/devices/d1/', 'MKCOL /orinui/vaults/v1/assets/',
      'PROPFIND /orinui/vaults/v1/assets/',
    ]);
  });

it('reads and conditionally creates the encrypted vault descriptor', async () => {
    let stored = '';
    const { remote } = setup((_url, init) => {
      if (init.method === 'PUT') {
        expect(new Headers(init.headers).get('If-None-Match')).toBe('*');
        stored = String(init.body);
        return ok('', 201, { ETag: '"vault-r1"' });
      }
      return stored ? ok(stored) : ok('', 404);
    });
    expect(await remote.readVault()).toBeNull();
    await remote.createVault({ vaultId: 'vault-1', ciphertext: Uint8Array.of(3, 4, 5) });
    const read = await remote.readVault();
    expect(read).toEqual({ vaultId: 'vault-1', ciphertext: Uint8Array.of(3, 4, 5) });
  });

it('lists direct device collections and gets strong snapshot ETags via PROPFIND', async () => {
    const { remote } = setup((url, init) => {
      if (init.method !== 'PROPFIND') throw new Error(`unexpected ${init.method}`);
      if (new Headers(init.headers).get('Depth') === '1') {
        return ok(xmlFor(response('/orinui/vaults/v1/devices/', { collection: true, etagStatus: 404 }),
          response('/orinui/vaults/v1/devices/device%20one/', { collection: true, etagStatus: 404 }),
          response('/orinui/vaults/v1/devices/nested/child/', { collection: true })), 207);
      }
      return ok(xmlFor(response(url.pathname, { etag: '"s1"' })), 207);
    });
    await expect(remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/直接子项/);

    const valid = setup((url, init) => new Headers(init.headers).get('Depth') === '1'
      ? ok(xmlFor(response('/orinui/vaults/v1/devices/', { collection: true, etagStatus: 404 }), response('/orinui/vaults/v1/devices/device%20one/', { collection: true, etagStatus: 404 })), 207)
      : ok(xmlFor(response(url.pathname, { etag: '"s1"' })), 207));
    await expect(valid.remote.objects.listSnapshots({ vaultId: 'v1' })).resolves.toEqual([{ deviceId: 'device one', revision: '"s1"' }]);

    const missingSnapshotTag = setup((url, init) => new Headers(init.headers).get('Depth') === '1'
      ? ok(xmlFor(response('/orinui/vaults/v1/devices/d1/', { collection: true, etagStatus: 404 })), 207)
      : ok(xmlFor(response(url.pathname, { collection: false, etagStatus: 404 })), 207));
    await expect(missingSnapshotTag.remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/getetag 属性查询未成功/);
  });

it('reads snapshots with exact If-Match and rejects stale or weak revisions', async () => {
    let captured: RequestInit | undefined;
    const { remote } = setup((_url, init) => { captured = init; return ok('snapshot-bytes', 200, { ETag: '"r7"' }); });
    const result = await remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: '"r7"' });
    expect(new Headers(captured?.headers).get('If-Match')).toBe('"r7"');
    expect(result.ciphertext).toEqual(new TextEncoder().encode('snapshot-bytes'));
    const stale = setup(() => ok('', 412));
    await expect(stale.remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: '"r6"' })).rejects.toThrow(/版本已变化/);
    await expect(remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: 'W/"weak"' })).rejects.toThrow(/强 ETag/);
  });

it('returns null for a missing asset and requires strong ETags for existing bytes', async () => {
    const missing = setup(() => ok('', 404));
    await expect(missing.remote.objects.readAsset({ vaultId: 'v1', objectId: 'a1' })).resolves.toBeNull();
    const weak = setup(() => ok('bytes', 200, { ETag: 'W/"weak"' }));
    await expect(weak.remote.objects.readAsset({ vaultId: 'v1', objectId: 'a1' })).rejects.toThrow(/强 ETag/);
  });

it('creates assets only when absent and re-reads condition races', async () => {
    let putInit: RequestInit | undefined;
    const created = setup((_url, init) => { putInit = init; return ok('', 201, { ETag: '"a1"' }); });
    await expect(created.remote.objects.createAsset({ vaultId: 'v1', objectId: 'a1', ciphertext: Uint8Array.of(8) }))
      .resolves.toEqual({ created: true, revision: '"a1"' });
    expect(new Headers(putInit?.headers).get('If-None-Match')).toBe('*');

    let count = 0;
    const raced = setup((_url, init) => {
      if (init.method === 'PUT') return ok('', 412);
      count += 1;
      return ok('existing', 200, { ETag: '"existing"' });
    });
    await expect(raced.remote.objects.createAsset({ vaultId: 'v1', objectId: 'a1', ciphertext: Uint8Array.of(8) }))
      .resolves.toEqual({ created: false, revision: '"existing"' });
    expect(count).toBe(1);
  });

it('publishes snapshots with create-only or exact replacement conditions', async () => {
    const conditions: string[] = [];
    const { remote } = setup((_url, init) => {
      const headers = new Headers(init.headers);
      conditions.push(headers.get('If-None-Match') ?? `match:${headers.get('If-Match')}`);
      return ok('', 204, { ETag: '"published"' });
    });
    await remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: null, ciphertext: Uint8Array.of(1) });
    await remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: '"old"', ciphertext: Uint8Array.of(2) });
    expect(conditions).toEqual(['*', 'match:"old"']);
    const conflict = setup(() => ok('', 412));
    await expect(conflict.remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: '"old"', ciphertext: Uint8Array.of(2) }))
      .rejects.toThrow(/条件发布冲突/);
  });

it('proves server preconditions and removes the probe with its observed strong ETag', async () => {
    const probeUrl = '/orinui/vaults/v1/probe-d1.enc';
    const stored = new Map<string, Uint8Array>();
    const calls: string[] = [];
    const { remote } = setup(conditionProbeHandler(probeUrl, stored, calls));
    await remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' });
    await remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' });
    expect(stored.size).toBe(0);
    expect(calls).toContain('PUT *');
    expect(calls).toContain('DELETE "probe-r1"');
  });

it('fails explicitly when If-None-Match is ignored and leaves its diagnostic probe', async () => {
    const { remote } = setup((url, init) => {
      if (init.method === 'PUT') return ok('', 201, { ETag: '"probe-r1"' });
      throw new Error(`unexpected ${init.method} ${url.pathname}`);
    });
    await expect(remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' })).rejects.toThrow(/预期 HTTP 412，实际 201/);
  });

it('rejects malformed DAV multistatus and non-success propstat entries', () => {
    const entries = parseWebDavMultiStatus(documentFor([response('/dav/', { collection: true, resourceTypeStatus: 200, etagStatus: 404 })]));
    expect(entries[0]).toMatchObject({ collection: true, resourceTypeStatus: 200, etagStatus: 404, etag: null });
    const wrongNamespace = element('multistatus', { namespaceURI: 'urn:wrong' });
    expect(() => parseWebDavMultiStatus({ documentElement: wrongNamespace, getElementsByTagName: () => [] } as unknown as Document)).toThrow(/multistatus/);
    const external = setup(() => ok(xmlFor(response('https://attacker.test/orinui/vaults/v1/devices/d1/', { collection: true })), 207));
    return expect(external.remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/越界 href/);
});
