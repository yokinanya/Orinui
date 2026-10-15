import { browser } from 'wxt/browser';
import { createBrowserSyncLock } from '@/platform/sync-lock';
import { fail } from '@/domain/errors';
import type { MediaAssetKind } from '@/domain/asset';
import { prepareImage } from '@/platform/images';
import { createRemoteImageDownloader, type DownloadedImage } from '@/platform/remote-image-download';

function requestRemoteImagePermissions(origins: readonly string[]): Promise<boolean> {
  if (!browser.permissions) fail('当前浏览器不支持按需申请网站权限');
  return browser.permissions.request({ permissions: ['webRequest'], origins: [...origins] });
}

function runWithRemoteImageLock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('当前浏览器未提供 Web Locks，无法安全协调图片下载');
  return createBrowserSyncLock(navigator.locks).runExclusive(scope, operation);
}

function getHeadersReceived(): typeof browser.webRequest.onHeadersReceived {
  const event = browser.webRequest?.onHeadersReceived;
  if (!event) throw new Error('当前浏览器不支持图片重定向检查');
  return event;
}

function getExtensionOrigin(): string {
  return browser.runtime.getURL('').replace(/\/$/, '');
}

export async function downloadRemoteImage(source: string, kind: MediaAssetKind): Promise<DownloadedImage> {
  return createRemoteImageDownloader({
    requestPermissions: requestRemoteImagePermissions,
    getHeadersReceived,
    fetch: (url, init) => fetch(url, init),
    runExclusive: runWithRemoteImageLock,
    extensionOrigin: getExtensionOrigin(),
    prepareImage,
  })(source, kind);
}
