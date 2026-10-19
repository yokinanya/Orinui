import { describe, expect, it } from 'vitest';
import { pinyin } from 'pinyin-pro';
import { buildLocalSearchIndex, searchLocalIndex } from '@/domain/local-search';
import type { Shortcut } from '@/domain/shortcut';

function site(input: { readonly id: string; readonly title: string; readonly order: number; readonly folderId?: string }): Shortcut {
  return { ...input, folderId: input.folderId ?? null, icon: { kind: 'letter' }, iconSourceUrl: null,
    url: `https://${input.id}.example.com` };
}

function index() {
  return buildLocalSearchIndex({ folders: [{ id: 'folder', name: '开发资料', order: 0 }],
    shortcuts: [site({ id: 'baidu', title: '百度', order: 1 }), site({ id: 'inside', title: '工具网站', folderId: 'folder', order: 0 }),
      site({ id: 'exact', title: 'bd', order: 3 }), site({ id: 'prefix', title: 'bd tools', order: 2 }),
      site({ id: 'contains', title: 'my bd website', order: 0 })],
    transliterate: (value) => ({ full: pinyin(value, { toneType: 'none', type: 'array' }).join(''),
      initials: pinyin(value, { pattern: 'first', type: 'array' }).join('') }) });
}

const ALL_SOURCES = { showSites: true, showFolders: true };

describe('本地搜索索引', () => {
  it('原文匹配在全拼及首拼之前，相同分数保持用户顺序', () => {
    const result = searchLocalIndex({ index: index(), query: 'bd', sources: ALL_SOURCES });
    expect(result.map(({ id }) => id)).toEqual(['exact', 'prefix', 'contains', 'baidu']);
  });

  it('支持全拼、首拼、文件夹名和多词原文', () => {
    expect(searchLocalIndex({ index: index(), query: 'baidu', sources: ALL_SOURCES }).map(({ id }) => id)).toEqual(['baidu']);
    expect(searchLocalIndex({ index: index(), query: 'kfzl', sources: ALL_SOURCES }).map(({ id }) => id))
      .toEqual(['inside', 'folder']);
    expect(searchLocalIndex({ index: index(), query: 'bd tools', sources: ALL_SOURCES }).map(({ id }) => id)).toEqual(['prefix']);
  });

  it('网站与文件夹来源可独立关闭，不改变原索引', () => {
    const items = index();
    const snapshot = structuredClone(items);
    expect(searchLocalIndex({ index: items, query: '开发', sources: { showSites: false, showFolders: true } })
      .map(({ id }) => id)).toEqual(['folder']);
    expect(searchLocalIndex({ index: items, query: '开发', sources: { showSites: true, showFolders: false } })
      .map(({ id }) => id)).toEqual(['inside']);
    expect(items).toEqual(snapshot);
  });

  it('不会索引已不存在文件夹中的网站，也不匹配空查询', () => {
    const items = buildLocalSearchIndex({ shortcuts: [site({ id: 'orphan', title: 'orphan', order: 0, folderId: 'deleted' })],
      folders: [], transliterate: (value) => ({ full: value, initials: value }) });
    expect(items).toEqual([]);
    expect(searchLocalIndex({ index: index(), query: ' ', sources: ALL_SOURCES })).toEqual([]);
  });

  it('同分时保持传入的当前顺序，不混用不同容器内的 order', () => {
    const items = buildLocalSearchIndex({ folders: [],
      shortcuts: [site({ id: 'first', title: 'tools A', order: 8 }), site({ id: 'second', title: 'tools B', order: 0 })],
      transliterate: (value) => ({ full: value, initials: value }) });
    expect(searchLocalIndex({ index: items, query: 'tools', sources: ALL_SOURCES }).map(({ id }) => id))
      .toEqual(['first', 'second']);
  });
});
