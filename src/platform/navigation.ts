/**
 * 页面导航。
 *
 * 视觉规格：快捷方式与搜索都在当前标签页打开，符合新标签页作为起始页的预期。
 * 集中在此处，便于将来针对不同浏览器目标调整行为。
 */
export function openInCurrentTab(url: string): void {
  window.location.assign(url);
}
