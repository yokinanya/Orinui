import { createHash } from 'node:crypto';
import { createServer } from 'node:https';

const DAV_ROOT = '/dav/';
const FIXTURE_USER = 'orinui-audit';
const FIXTURE_PASSWORD = 'fixture-only-password';

function etag(bytes) {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

function normalizePath(requestUrl) {
  const path = decodeURIComponent(new URL(requestUrl, 'https://localhost').pathname);
  if (!path.startsWith(DAV_ROOT) || path.includes('..')) return null;
  return path;
}

function parentCollection(path) {
  const trimmed = path.replace(/\/$/, '');
  return `${trimmed.slice(0, trimmed.lastIndexOf('/') + 1)}`;
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function send({ response, status, body = '', headers = {} }) {
  response.writeHead(status, headers);
  response.end(body);
}

async function readBody(request) {
  const parts = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

function lookup(entries, path) {
  return entries.get(path) ?? entries.get(`${path.replace(/\/$/, '')}/`);
}

function propfindEntry({ path, entry, origin }) {
  const escaped = xmlEscape(path);
  const collection = entry.collection ? '<d:collection/>' : '';
  const tag = entry.collection ? '' : `<d:getetag>${entry.etag}</d:getetag>`;
  return `<d:response><d:href>${origin}${escaped}</d:href><d:propstat><d:prop><d:resourcetype>${collection}</d:resourcetype>${tag}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function propfindResponse({ path, depth, entry, entries, origin }) {
  const found = [propfindEntry({ path, entry, origin })];
  if (depth !== '1' || !entry.collection) return found.join('');
  const prefix = path.endsWith('/') ? path : `${path}/`;
  for (const [candidate, child] of entries) {
    if (candidate === path || !candidate.startsWith(prefix)) continue;
    const relative = candidate.slice(prefix.length).replace(/\/$/, '');
    if (!relative || relative.includes('/')) continue;
    found.push(propfindEntry({ path: candidate, entry: child, origin }));
  }
  return found.join('');
}

function handlePropfind({ request, response, path, entries, origin }) {
  const entry = lookup(entries, path);
  if (!entry) return send({ response, status: 404 });
  const depth = request.headers.depth ?? '0';
  const body = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${propfindResponse({ path, depth, entry, entries, origin })}</d:multistatus>`;
  send({ response, status: 207, body, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

function handleMkcol({ response, path, entries }) {
  if (lookup(entries, path)) return send({ response, status: 405 });
  const parent = entries.get(parentCollection(path));
  if (!parent?.collection) return send({ response, status: 409 });
  entries.set(`${path.replace(/\/$/, '')}/`, { collection: true, etag: null, bytes: null });
  return send({ response, status: 201 });
}

function conditionMatches(request, current) {
  const noneMatch = request.headers['if-none-match'];
  if (noneMatch === '*') return current === undefined;
  const match = request.headers['if-match'];
  if (match !== undefined) return current !== undefined && !current.collection && current.etag === match;
  return true;
}

async function handlePut({ request, response, path, entries }) {
  const parent = entries.get(parentCollection(path));
  if (!parent?.collection) return send({ response, status: 409 });
  const current = lookup(entries, path);
  if (!conditionMatches(request, current)) return send({ response, status: 412 });
  const bytes = await readBody(request);
  const revision = etag(bytes);
  entries.set(path, { collection: false, etag: revision, bytes });
  return send({ response, status: current ? 204 : 201, headers: { ETag: revision } });
}

function handleGet({ request, response, path, entries, headOnly = false }) {
  const entry = lookup(entries, path);
  if (!entry || entry.collection) return send({ response, status: 404 });
  if (!conditionMatches(request, entry)) return send({ response, status: 412 });
  response.writeHead(200, { ETag: entry.etag, 'Content-Type': 'application/octet-stream', 'Content-Length': entry.bytes.length });
  if (headOnly) return response.end();
  return response.end(entry.bytes);
}

function handleDelete({ request, response, path, entries }) {
  const entry = lookup(entries, path);
  if (!entry) return send({ response, status: 404 });
  if (!conditionMatches(request, entry)) return send({ response, status: 412 });
  for (const candidate of entries.keys()) {
    if (candidate === path || candidate.startsWith(path.endsWith('/') ? path : `${path}/`)) entries.delete(candidate);
  }
  return send({ response, status: 204 });
}

function routeRequest({ method, request, response, path, state, origin }) {
  if (method === 'PROPFIND') return handlePropfind({ request, response, path, entries: state.entries, origin });
  if (method === 'MKCOL') return handleMkcol({ response, path, entries: state.entries });
  if (method === 'PUT') return handlePut({ request, response, path, entries: state.entries });
  if (method === 'GET' || method === 'HEAD') return handleGet({ request, response, path,
    entries: state.entries, headOnly: method === 'HEAD' });
  if (method === 'DELETE') return handleDelete({ request, response, path, entries: state.entries });
  return send({ response, status: 405 });
}

function handleRequest({ request, response, state, origin }) {
  const path = normalizePath(request.url ?? '/');
  const method = request.method ?? 'GET';
  state.requests.push({ method, path, hasAuthorization: Boolean(request.headers.authorization) });
  if (request.headers.authorization !== basicAuth(FIXTURE_USER, FIXTURE_PASSWORD)) {
    return send({ response, status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Orinui audit fixture"' } });
  }
  if (!path) return send({ response, status: 404 });
  return routeRequest({ method, request, response, path, state, origin });
}

export async function startWebDavFixture({ key, certificate }) {
  const state = { entries: new Map([[DAV_ROOT, { collection: true, etag: null, bytes: null }]]), requests: [] };
  const server = createServer({ key, cert: certificate }, (request, response) => {
    const origin = `https://${request.headers.host}`;
    void Promise.resolve(handleRequest({ request, response, state, origin })).catch((error) => {
      state.requests.push({ method: 'FIXTURE_ERROR', path: String(error) });
      send({ response, status: 500 });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('WebDAV fixture 未取得 TCP 地址');
  const origin = `https://localhost:${address.port}`;
  return {
    origin,
    url: `${origin}${DAV_ROOT}`,
    state,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export const webDavFixtureCredentials = Object.freeze({ username: FIXTURE_USER, password: FIXTURE_PASSWORD });
