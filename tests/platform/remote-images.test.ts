import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedirectConfirmationRequiredError, RemoteImageRedirectError } from '@/domain/remote-image-errors';
import { createRemoteImageDownloader, type RemoteImageDownloadPorts } from '@/platform/remote-image-download';

type HeadersEvent = ReturnType<RemoteImageDownloadPorts['getHeadersReceived']>;
type HeadersListener = Parameters<HeadersEvent['addListener']>[0];
type HeadersDetails = Parameters<HeadersListener>[0];

const EXTENSION_ORIGIN = 'chrome-extension://orinui-test';

interface RedirectDetailsInput {
  readonly url: string;
  readonly location: string | undefined;
  readonly changes?: Partial<HeadersDetails>;
}

function makeResponse(status = 200): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': 'image/png' } });
}

function createHarness() {
  const listeners = new Set<HeadersListener>();
  const requestPermissions = vi.fn().mockResolvedValue(true);
  const fetchImage = vi.fn().mockResolvedValue(makeResponse());
  const prepareImage = vi.fn().mockResolvedValue({ id: 'asset-1', kind: 'icon' });
  const removeListener = vi.fn((listener: HeadersListener) => { listeners.delete(listener); });
  const headersReceived = {
    addListener: vi.fn((listener: HeadersListener) => { listeners.add(listener); }),
    removeListener,
  } as unknown as HeadersEvent;
  const runExclusive = vi.fn();
  const withLock = <T>(scope: string, operation: () => Promise<T>): Promise<T> => {
    runExclusive(scope);
    return operation();
  };
  const ports: RemoteImageDownloadPorts = {
    requestPermissions,
    getHeadersReceived: () => headersReceived,
    fetch: fetchImage,
    runExclusive: withLock,
    extensionOrigin: EXTENSION_ORIGIN,
    prepareImage,
  };
  return {
    download: createRemoteImageDownloader(ports),
    listeners,
    requestPermissions,
    fetchImage,
    prepareImage,
    removeListener,
    headersReceived,
    runExclusive,
  };
}

function emitRedirect(listeners: ReadonlySet<HeadersListener>, input: RedirectDetailsInput): void {
  const details = {
    url: input.url,
    method: 'GET',
    initiator: EXTENSION_ORIGIN,
    statusCode: 301,
    responseHeaders: input.location === undefined ? [] : [{ name: 'Location', value: input.location }],
    ...input.changes,
  } as HeadersDetails;
  listeners.forEach((listener) => listener(details));
}

afterEach(() => vi.restoreAllMocks());

describe('download permission and network request', () => {
  it('requests webRequest and only the current origin before the network call', async () => {
    const harness = createHarness();
    harness.requestPermissions.mockResolvedValue(false);

    await expect(harness.download('https://cdn.example.org/icon.png', 'icon'))
      .rejects.toThrow('未获得图片下载所需的网站与网络观察权限');
    expect(harness.requestPermissions).toHaveBeenCalledWith(['https://cdn.example.org/*']);
    expect(harness.fetchImage).not.toHaveBeenCalled();
    expect(harness.headersReceived.addListener).not.toHaveBeenCalled();
  });

  it('uses redirect:error, omits credentials and referrer, then cleans up the observer', async () => {
    const harness = createHarness();
    await harness.download('https://cdn.example.org/icon.png?size=small', 'icon');

    expect(harness.fetchImage).toHaveBeenCalledWith(new URL('https://cdn.example.org/icon.png?size=small'), {
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    expect(harness.headersReceived.addListener).toHaveBeenCalledWith(expect.any(Function), {
      urls: ['https://cdn.example.org/*'], types: ['xmlhttprequest'],
    }, ['responseHeaders']);
    expect(harness.listeners.size).toBe(0);
  });

  it('keeps an unrelated fetch/network failure cause', async () => {
    const harness = createHarness();
    const cause = new TypeError('Failed to fetch');
    harness.fetchImage.mockRejectedValue(cause);

    const error = await harness.download('https://cdn.example.org/icon.png', 'icon').catch((value: unknown) => value);
    expect(error).toMatchObject({ message: expect.stringMatching(/网络错误或 CORS/), cause });
  });
});

describe('redirect confirmation and same-origin hops', () => {
  it('replays validated same-origin hops and stores the actual final URL', async () => {
    const harness = createHarness();
    const cause = new TypeError('redirect blocked');
    harness.fetchImage.mockImplementationOnce(async (url: URL) => {
      emitRedirect(harness.listeners, { url: url.href, location: '/final.png' });
      throw cause;
    });

    await expect(harness.download('https://cdn.example.org/start.png', 'icon')).resolves.toMatchObject({
      id: 'asset-1', sourceUrl: 'https://cdn.example.org/final.png',
    });
    expect(harness.fetchImage.mock.calls.map(([url]) => url.href)).toEqual([
      'https://cdn.example.org/start.png', 'https://cdn.example.org/final.png',
    ]);
    expect(harness.runExclusive.mock.calls).toEqual([
      ['orinui:remote-image:https://cdn.example.org/start.png'],
      ['orinui:remote-image:https://cdn.example.org/final.png'],
    ]);
    expect(harness.fetchImage.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
  });

  it('stops before fetching a cross-origin target and exposes the URLs for confirmation', async () => {
    const harness = createHarness();
    const cause = new TypeError('redirect blocked');
    harness.fetchImage.mockImplementation(async (url: URL) => {
      emitRedirect(harness.listeners, { url: url.href, location: 'https://images.example.net/final.png' });
      throw cause;
    });

    const error = await harness.download('https://cdn.example.org/start.png', 'icon').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(RedirectConfirmationRequiredError);
    expect(error).toMatchObject({
      sourceUrl: 'https://cdn.example.org/start.png',
      targetUrl: 'https://images.example.net/final.png',
      cause,
    });
    expect(harness.fetchImage).toHaveBeenCalledTimes(1);
  });
});

describe('confirmed origin and redirect target validation', () => {
  it('does not fetch a target until a later call explicitly requests its origin permission', async () => {
    const harness = createHarness();
    harness.fetchImage.mockImplementationOnce(async (url: URL) => {
      emitRedirect(harness.listeners, { url: url.href, location: 'https://images.example.net/final.png' });
      throw new TypeError('redirect blocked');
    });
    await expect(harness.download('https://cdn.example.org/start.png', 'icon'))
      .rejects.toBeInstanceOf(RedirectConfirmationRequiredError);
    harness.fetchImage.mockResolvedValue(makeResponse());

    await harness.download('https://images.example.net/final.png', 'icon');
    expect(harness.requestPermissions.mock.calls).toEqual([
      [['https://cdn.example.org/*']], [['https://images.example.net/*']],
    ]);
    expect(harness.fetchImage.mock.calls.map(([url]) => url.href)).toEqual([
      'https://cdn.example.org/start.png', 'https://images.example.net/final.png',
    ]);
  });
});

describe('redirect errors and listener filtering', () => {
  it('surfaces missing and invalid Location with their causes', async () => {
    const missing = createHarness();
    const missingCause = new TypeError('redirect blocked');
    missing.fetchImage.mockImplementationOnce(async (url: URL) => {
      emitRedirect(missing.listeners, { url: url.href, location: undefined });
      throw missingCause;
    });
    const missingError = await missing.download('https://cdn.example.org/start.png', 'icon').catch((value: unknown) => value);
    expect(missingError).toBeInstanceOf(RemoteImageRedirectError);
    expect(missingError).toMatchObject({ message: '图片重定向缺少 Location 地址', cause: missingCause });

    const invalid = createHarness();
    const invalidCause = new TypeError('redirect blocked');
    invalid.fetchImage.mockImplementationOnce(async (url: URL) => {
      emitRedirect(invalid.listeners, { url: url.href, location: 'https://127.0.0.1/private.png' });
      throw invalidCause;
    });
    const invalidError = await invalid.download('https://cdn.example.org/start.png', 'icon').catch((value: unknown) => value);
    expect(invalidError).toBeInstanceOf(RemoteImageRedirectError);
    if (!(invalidError instanceof RemoteImageRedirectError)) throw invalidError;
    expect(invalidError.message).toMatch(/图片重定向目标无效.*本机或内网/);
    expect(invalidError.cause).toMatchObject({ errors: [expect.any(Error), invalidCause] });
  });

  it('rejects redirect cycles without imposing a hop count', async () => {
    const harness = createHarness();
    harness.fetchImage.mockImplementation(async (url: URL) => {
      emitRedirect(harness.listeners, { url: url.href, location: '/start.png#new-fragment' });
      throw new TypeError('redirect blocked');
    });

    await expect(harness.download('https://cdn.example.org/start.png', 'icon'))
      .rejects.toMatchObject({ name: 'RemoteImageRedirectError', message: '图片重定向形成循环' });
    expect(harness.fetchImage).toHaveBeenCalledTimes(1);
  });

  it('ignores headers from another URL, non-GET requests, or a different initiator', async () => {
    const harness = createHarness();
    const cause = new TypeError('Failed to fetch');
    harness.fetchImage.mockImplementationOnce(async () => {
      emitRedirect(harness.listeners, { url: 'https://cdn.example.org/other.png', location: '/target.png' });
      emitRedirect(harness.listeners, { url: 'https://cdn.example.org/start.png', location: '/target.png', changes: { method: 'POST' } });
      emitRedirect(harness.listeners, { url: 'https://cdn.example.org/start.png', location: '/target.png', changes: { initiator: 'https://example.com' } });
      throw cause;
    });

    const error = await harness.download('https://cdn.example.org/start.png', 'icon').catch((value: unknown) => value);
    expect(error).toMatchObject({ cause, message: expect.stringMatching(/网络错误或 CORS/) });
  });
});

describe('image response and listener cleanup', () => {
  it('distinguishes HTTP and image preparation errors', async () => {
    const http = createHarness();
    http.fetchImage.mockResolvedValue(makeResponse(404));
    await expect(http.download('https://cdn.example.org/icon.png', 'icon')).rejects.toThrow('图片下载失败（HTTP 404）');

    const prepare = createHarness();
    const prepareError = new Error('图片格式不受支持');
    prepare.prepareImage.mockRejectedValue(prepareError);
    await expect(prepare.download('https://cdn.example.org/icon.png', 'icon')).rejects.toBe(prepareError);
  });

  it('reports listener cleanup failures explicitly and preserves the fetch cause', async () => {
    const harness = createHarness();
    const fetchCause = new TypeError('redirect blocked');
    const cleanupCause = new Error('removeListener failed');
    harness.fetchImage.mockRejectedValue(fetchCause);
    harness.removeListener.mockImplementationOnce(() => { throw cleanupCause; });

    const error = await harness.download('https://cdn.example.org/icon.png', 'icon').catch((value: unknown) => value);
    if (!(error instanceof Error)) throw error;
    expect(error).toMatchObject({ message: '图片重定向监听器清理失败' });
    expect(error.cause).toMatchObject({ errors: [fetchCause, cleanupCause] });
  });
});
