import { describe, expect, it } from 'vitest';
import { resolveSearchQuery } from '@/domain/search-query';
import { createDefaultSettings } from '@/domain/settings';

function preferences() {
  const search = createDefaultSettings().search;
  return { ...search, customization: { ...search.customization, engineKeywords: { bing: 'b' } } };
}

describe('单次搜索路由', () => {
  it('按完整关键词选择引擎，保留查询语义并且不改变默认值', () => {
    const settings = preferences();
    const before = structuredClone(settings);
    const result = resolveSearchQuery({ settings, query: ' B 中文 & symbols+# ' });
    expect(result).toMatchObject({ keyword: true, engineName: 'Bing', query: '中文 & symbols+#' });
    expect(new URL(result.searchUrl).searchParams.get('q')).toBe('中文 & symbols+#');
    expect(settings).toEqual(before);
    expect(resolveSearchQuery({ settings, query: 'book' })).toMatchObject({ keyword: false, engineName: 'Google' });
  });

  it('缺少关键词参数时明确提示，不生成空查询导航', () => {
    expect(resolveSearchQuery({ settings: preferences(), query: 'b' })).toMatchObject({ keyword: true,
      error: '请输入要用 Bing 搜索的内容' });
  });

  it('使用已编辑的预置引擎名称和模板构造查询地址', () => {
    const defaults = preferences();
    const search = { ...defaults, customization: { ...defaults.customization,
      engineOverrides: { google: { name: 'Google 中文', template: 'https://search.example/?query={query}' } } } };
    expect(resolveSearchQuery({ settings: search, query: '关键词 a&b' })).toMatchObject({
      engineName: 'Google 中文', searchUrl: 'https://search.example/?query=%E5%85%B3%E9%94%AE%E8%AF%8D%20a%26b',
    });
  });

  it('网址保留路径、查询、片段，域名补 HTTPS', () => {
    const settings = preferences();
    expect(resolveSearchQuery({ settings, query: 'example.com/a?q=中文#section' }).navigationUrl)
      .toBe('https://example.com/a?q=中文#section');
    expect(resolveSearchQuery({ settings, query: 'http://localhost:8080/a' }).navigationUrl)
      .toBe('http://localhost:8080/a');
    expect(resolveSearchQuery({ settings, query: '127.0.0.1:8080/a' }).navigationUrl)
      .toBe('https://127.0.0.1:8080/a');
  });

  it.each(['2.3', '1.2+3.4', 'normal words', 'owner/repo#123', 'user@example.com'])('不会将 %s 当作网址', (query) => {
    expect(resolveSearchQuery({ settings: preferences(), query }).navigationUrl).toBeUndefined();
  });

  it.each(['https://user:password@example.com', 'file://example.com/a', 'http://[bad'])('非法显式地址 %s 返回错误', (query) => {
    expect(resolveSearchQuery({ settings: preferences(), query }).error).toBeTruthy();
  });
});
