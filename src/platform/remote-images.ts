import { browser } from 'wxt/browser';
import { fail } from '@/domain/errors';
import { IMAGE_FILE_LIMIT } from '@/domain/image';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';
import type { ImageAssetKind } from '@/domain/asset';
import { prepareImage } from '@/platform/images';
import type { NewImageAsset } from '@/storage/assets';

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

/** Must be entered directly by the download button so the optional permission stays user initiated. */
export async function downloadRemoteImage(source: string, kind: ImageAssetKind): Promise<NewImageAsset> {
  const { url, originPattern } = validateRemoteImageUrl(source);
  if (!browser.permissions) fail('当前浏览器不支持按需申请网站权限');
  const granted = await browser.permissions.request({ origins: [originPattern] });
  if (!granted) fail('未获得此图片来源的网站权限');
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) fail(`图片下载失败（HTTP ${response.status}）`);
  const blob = await readBoundedResponse(response);
  return { ...await prepareImage({ blob, kind }), sourceUrl: url.href };
}
