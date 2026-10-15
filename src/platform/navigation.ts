import type { OpenTarget } from '@/domain/settings';

/** 页面导航集中于平台边界，网站本身仍使用原生链接。 */
export function openUrl(url: string, target: OpenTarget): void {
  if (target === 'current-tab') {
    window.location.assign(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
