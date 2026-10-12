import { RemoteImageRedirectError } from '@/domain/remote-image-errors';
import { validateRemoteImageUrl, type RemoteImageLocation } from '@/domain/remote-image-url';

export function remoteImageRequestKey(url: string | URL): string {
  const requestUrl = new URL(url);
  requestUrl.hash = '';
  return requestUrl.href;
}

export function resolveRemoteImageRedirect(
  sourceUrl: string,
  location: string | undefined,
  cause?: unknown,
): RemoteImageLocation {
  if (!location) {
    throw new RemoteImageRedirectError(sourceUrl, '图片重定向缺少 Location 地址', { cause });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(location, sourceUrl);
  } catch (targetError) {
    const parseCause = new AggregateError([targetError, cause], '图片重定向地址解析失败');
    throw new RemoteImageRedirectError(sourceUrl, '图片重定向地址格式不正确', { cause: parseCause });
  }

  try {
    return validateRemoteImageUrl(targetUrl.href);
  } catch (targetError) {
    const reason = targetError instanceof Error ? `：${targetError.message}` : '';
    const validationCause = new AggregateError([targetError, cause], '图片重定向目标校验失败');
    throw new RemoteImageRedirectError(sourceUrl, `图片重定向目标无效${reason}`, { cause: validationCause });
  }
}

export function assertRemoteImageRedirectIsNew(visitedUrls: ReadonlySet<string>, targetUrl: URL, cause?: unknown): void {
  if (visitedUrls.has(remoteImageRequestKey(targetUrl))) {
    throw new RemoteImageRedirectError(targetUrl.href, '图片重定向形成循环', { cause });
  }
}
