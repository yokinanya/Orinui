import type { browser } from 'wxt/browser';
import { RedirectConfirmationRequiredError } from '@/domain/remote-image-errors';
import { assertRemoteImageRedirectIsNew, remoteImageRequestKey, resolveRemoteImageRedirect } from '@/domain/remote-image-redirect';
import { fail } from '@/domain/errors';
import { IMAGE_FILE_LIMIT } from '@/domain/image';
import { validateRemoteImageUrl, type RemoteImageLocation } from '@/domain/remote-image-url';
import type { ImageAssetKind } from '@/domain/asset';
import type { NewImageAsset } from '@/storage/assets';

type HeadersReceivedEvent = typeof browser.webRequest.onHeadersReceived;
type HeadersReceivedListener = Parameters<HeadersReceivedEvent['addListener']>[0];
type HeadersReceivedDetails = Parameters<HeadersReceivedListener>[0];

interface RedirectResponse {
  readonly statusCode: number;
  readonly location: string | undefined;
  readonly cause: unknown;
}

type FetchAttempt = { readonly response: Response } | { readonly redirect: RedirectResponse };

export type DownloadedImage = NewImageAsset & { readonly sourceUrl: string };

export interface RemoteImageDownloadPorts {
  readonly requestPermissions: (origins: readonly string[]) => Promise<boolean>;
  readonly getHeadersReceived: () => HeadersReceivedEvent;
  readonly fetch: (url: URL, init: RequestInit) => Promise<Response>;
  readonly runExclusive: <T>(scope: string, operation: () => Promise<T>) => Promise<T>;
  readonly extensionOrigin: string;
  readonly prepareImage: (input: { readonly blob: Blob; readonly kind: ImageAssetKind }) => Promise<NewImageAsset>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REMOTE_IMAGE_LOCK_PREFIX = 'orinui:remote-image:';

function makeLockName(url: URL): string {
  return `${REMOTE_IMAGE_LOCK_PREFIX}${remoteImageRequestKey(url)}`;
}

function findLocation(details: HeadersReceivedDetails): string | undefined {
  return details.responseHeaders?.find((header) => header.name.toLowerCase() === 'location')?.value;
}

function matchesRedirect(details: HeadersReceivedDetails, url: URL, extensionOrigin: string): boolean {
  const isCurrentRequest = remoteImageRequestKey(details.url) === remoteImageRequestKey(url);
  const isExtensionRequest = details.initiator?.replace(/\/$/, '') === extensionOrigin;
  return isCurrentRequest && details.method === 'GET' && isExtensionRequest && REDIRECT_STATUSES.has(details.statusCode);
}

function createRedirectListener(
  url: URL,
  extensionOrigin: string,
  onRedirect: (redirect: Omit<RedirectResponse, 'cause'>) => void,
): HeadersReceivedListener {
  return (details) => {
    if (!matchesRedirect(details, url, extensionOrigin)) return undefined;
    onRedirect({ statusCode: details.statusCode, location: findLocation(details) });
    return undefined;
  };
}

interface RedirectListenerCleanupOptions {
  readonly listener: HeadersReceivedListener;
  readonly headersReceived: HeadersReceivedEvent;
  readonly failed: boolean;
  readonly fetchFailure: unknown;
}

async function fetchCurrentUrl(url: RemoteImageLocation, ports: RemoteImageDownloadPorts): Promise<FetchAttempt> {
  let redirect: Omit<RedirectResponse, 'cause'> | undefined;
  const listener = createRedirectListener(url.url, ports.extensionOrigin, (result) => { redirect = result; });
  const headersReceived = ports.getHeadersReceived();
  headersReceived.addListener(listener, { urls: [url.originPattern], types: ['xmlhttprequest'] }, ['responseHeaders']);
  let fetchFailure: unknown;
  let failed = false;
  try {
    const response = await ports.fetch(url.url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    return { response };
  } catch (cause) {
    fetchFailure = cause;
    failed = true;
    if (redirect) return { redirect: { ...redirect, cause } };
    throw new Error('图片来源无法读取，可能是网络错误或 CORS 限制。请检查来源地址后重试。', { cause });
  } finally {
    removeRedirectListener({ listener, headersReceived, failed, fetchFailure });
  }
}

function removeRedirectListener(options: RedirectListenerCleanupOptions): void {
  try {
    options.headersReceived.removeListener(options.listener);
  } catch (cleanupFailure) {
    const cause = options.failed ? new AggregateError([options.fetchFailure, cleanupFailure]) : cleanupFailure;
    throw new Error('图片重定向监听器清理失败', { cause });
  }
}

function resolveNextHop(current: RemoteImageLocation, redirect: RedirectResponse, visited: ReadonlySet<string>): RemoteImageLocation {
  const next = resolveRemoteImageRedirect(current.url.href, redirect.location, redirect.cause);
  assertRemoteImageRedirectIsNew(visited, next.url, redirect.cause);
  if (next.url.origin !== current.url.origin) {
    throw new RedirectConfirmationRequiredError(current.url.href, next.url.href, { cause: redirect.cause });
  }
  return next;
}

async function readBoundedResponse(response: Response): Promise<Blob> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > IMAGE_FILE_LIMIT) fail('图片原文件不能超过 10 MiB');
  const reader = response.body?.getReader();
  if (!reader) fail('图片响应没有内容');
  const chunks: Blob[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > IMAGE_FILE_LIMIT) {
      await reader.cancel();
      fail('图片原文件不能超过 10 MiB');
    }
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(new Blob([chunk.buffer]));
  }
  return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0]?.trim() ?? '' });
}

async function downloadPermittedImage(
  initialUrl: RemoteImageLocation,
  kind: ImageAssetKind,
  ports: RemoteImageDownloadPorts,
): Promise<DownloadedImage> {
  const visited = new Set([remoteImageRequestKey(initialUrl.url)]);
  let current = initialUrl;
  while (true) {
    const attempt = await ports.runExclusive(makeLockName(current.url), () => fetchCurrentUrl(current, ports));
    if ('response' in attempt) {
      if (!attempt.response.ok) fail(`图片下载失败（HTTP ${attempt.response.status}）`);
      return { ...await ports.prepareImage({ blob: await readBoundedResponse(attempt.response), kind }), sourceUrl: current.url.href };
    }
    current = resolveNextHop(current, attempt.redirect, visited);
    visited.add(remoteImageRequestKey(current.url));
  }
}

export function createRemoteImageDownloader(ports: RemoteImageDownloadPorts) {
  return async (source: string, kind: ImageAssetKind): Promise<DownloadedImage> => {
    const initialUrl = validateRemoteImageUrl(source);
    const granted = await ports.requestPermissions([initialUrl.originPattern]);
    if (!granted) fail('未获得图片下载所需的网站与网络观察权限');
    return downloadPermittedImage(initialUrl, kind, ports);
  };
}
