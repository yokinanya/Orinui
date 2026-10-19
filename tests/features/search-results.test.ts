import { describe, expect, it, vi } from 'vitest';
import { buildSearchResults } from '@/features/search/build-search-results';
import { executeSearchSuggestion } from '@/features/search/execute-search-suggestion';
import { createDefaultSettings } from '@/domain/settings';

const CONTEXT = { now: new Date('2026-10-19T12:00:00Z'), timeZone: 'Asia/Hong_Kong' };

function results(query: string) {
  return buildSearchResults({ query, settings: createDefaultSettings().search, context: CONTEXT,
    index: [], indexStatus: 'ready', indexError: null });
}

describe('搜索结果和动作', () => {
  it('普通文字及裸编号不自动跳转，明确网址提供打开动作', () => {
    expect(results('owner/repo#123').defaultId).toBe('search');
    expect(results('普通文字').defaultId).toBe('search');
    expect(results('example.com').defaultId).toBe('navigation');
    expect(results('2.3').defaultId).toBe('search');
  });

  it('显式 gh 命令不产生普通搜索备选，非法参数不会外发', () => {
    const good = results('gh owner/repo#123');
    expect(good.items.some(({ kind }) => kind === 'search')).toBe(false);
    expect(good.items.find(({ id }) => id === good.defaultId)).toMatchObject({ kind: 'open',
      value: 'https://github.com/owner/repo/issues/123' });
    expect(results('gh owner/repo#wrong').items).toEqual([expect.objectContaining({ kind: 'error' })]);
    expect(results('GitHub').defaultId).toBe('search');
  });

  it('实例只回填，颜色结果有多个独立动作和唯一标识', () => {
    expect(results('?').items.every(({ kind }) => kind === 'fill')).toBe(true);
    const colors = results('#6750a4');
    const actions = colors.items.filter(({ section }) => section === 'tool');
    expect(actions.length).toBeGreaterThan(1);
    expect(new Set(actions.map(({ id }) => id)).size).toBe(actions.length);
    expect(actions.every(({ swatch }) => Boolean(swatch))).toBe(true);
  });

  it('关闭全部工具后问号明确显示未启用，不降级成网页搜索', () => {
    const search = createDefaultSettings().search;
    const settings = { ...search, customization: { ...search.customization, enabledTools: [] } };
    const output = buildSearchResults({ query: '?', settings, context: CONTEXT,
      index: [], indexStatus: 'ready', indexError: null });
    expect(output.items).toEqual([expect.objectContaining({ kind: 'status', label: '此快捷工具未启用' })]);
  });

});

describe('本地状态与动作执行', () => {
  it('索引加载与读取错误显式显示，关闭来源后不显示索引状态', () => {
    const input = { query: 'abc', settings: createDefaultSettings().search, context: CONTEXT, index: [] };
    expect(buildSearchResults({ ...input, indexStatus: 'error', indexError: 'IndexedDB failed' }).items)
      .toContainEqual(expect.objectContaining({ kind: 'error', detail: 'IndexedDB failed' }));
    expect(buildSearchResults({ ...input, indexStatus: 'loading', indexError: null }).items)
      .toContainEqual(expect.objectContaining({ kind: 'status' }));
    const settings = { ...input.settings, customization: { ...input.settings.customization, showSites: false, showFolders: false } };
    expect(buildSearchResults({ ...input, settings, indexStatus: 'loading', indexError: null }).items)
      .not.toContainEqual(expect.objectContaining({ kind: 'status' }));
  });

  it('复制失败直接抛错，不伪造成功或执行导航', async () => {
    const ports = { copy: vi.fn().mockRejectedValue(new Error('clipboard rejected')), open: vi.fn(),
      openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn() };
    await expect(executeSearchSuggestion({ item: { id: 'copy', kind: 'copy', section: 'tool', label: '复制', detail: 'x', value: 'x' },
      targets: { search: 'current-tab', shortcut: 'new-tab' }, ports })).rejects.toThrow('clipboard rejected');
    expect(ports.copied).not.toHaveBeenCalled();
    expect(ports.open).not.toHaveBeenCalled();
    expect(ports.dismiss).not.toHaveBeenCalled();
  });

  it('来源决定打开目标，填入示例不打开或复制', async () => {
    const ports = { copy: vi.fn(), open: vi.fn(), openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn() };
    const targets = { search: 'current-tab', shortcut: 'new-tab' } as const;
    const base = { id: 'action', label: 'action', detail: '', value: 'https://example.com' };
    await executeSearchSuggestion({ item: { ...base, section: 'site', kind: 'open' }, targets, ports });
    expect(ports.open).toHaveBeenCalledWith(base.value, 'new-tab');
    await executeSearchSuggestion({ item: { ...base, section: 'tool', kind: 'fill' }, targets, ports });
    expect(ports.fill).toHaveBeenCalledWith(base.value);
    expect(ports.open).toHaveBeenCalledTimes(1);
    expect(ports.copy).not.toHaveBeenCalled();
  });
});
