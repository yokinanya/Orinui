import { useEffect, useState } from 'react';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { buildBookmarkSearchIndex, buildLocalSearchIndex, type BookmarkSearchProjection,
  type LocalSearchItem, type TransliterateSearchText } from '@/domain/local-search';

interface IndexState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly items: readonly LocalSearchItem[];
  /** 浏览器书签索引；只由注入的投影派生，与自有索引共用一次拼音词典加载。 */
  readonly bookmarkItems: readonly LocalSearchItem[];
  readonly error: string | null;
}

/** 调用方持有书签状态与投影；搜索模块不读取浏览器 API、权限或缓存。 */
export interface BookmarkIndexInput {
  /** settings.bookmarks.showInSearch。 */
  readonly showInSearch: boolean;
  /** 已完成状态判定与隐藏投影的快照；null 表示本设备当前没有可读投影。 */
  readonly projection: BookmarkSearchProjection | null;
}

interface IndexInput {
  readonly enabled: boolean;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly listAllShortcuts: () => Promise<Shortcut[]>;
  readonly bookmarks?: BookmarkIndexInput;
}

async function readSearchIndex(input: IndexInput): Promise<Pick<IndexState, 'items' | 'bookmarkItems'>> {
  const [shortcuts, { pinyin }] = await Promise.all([input.listAllShortcuts(), import('pinyin-pro')]);
  const transliterate: TransliterateSearchText = (text) => ({
    full: pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join(''),
    initials: pinyin(text, { pattern: 'first', type: 'array', nonZh: 'consecutive' }).join(''),
  });
  const own = buildLocalSearchIndex({ shortcuts, folders: input.folders, transliterate });
  const bookmarks = input.bookmarks?.showInSearch === true
    ? buildBookmarkSearchIndex(input.bookmarks.projection ?? undefined, transliterate) : [];
  return { items: own, bookmarkItems: bookmarks };
}

const EMPTY: IndexState = { status: 'idle', items: [], bookmarkItems: [], error: null };

/**
 * 索引只在本地内容或书签投影改变时重建；首次使用才加载随包拼音词典。
 *
 * 书签投影是调用方注入的不可变快照，因此投影身份变化会连同状态（ready → stale）
 * 一起重建；关闭开关时不保留旧书签结果，避免关闭后仍能搜索到书签。
 */
export function useLocalSearchIndex(input: IndexInput): IndexState {
  const [state, setState] = useState<IndexState>(EMPTY);
  const { enabled, folders, shortcuts, listAllShortcuts, bookmarks } = input;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ ...EMPTY, status: 'loading' });
    void readSearchIndex({ enabled, folders, shortcuts, listAllShortcuts, bookmarks }).then((indexes) => {
      if (!cancelled) setState({ status: 'ready', ...indexes, error: null });
    }).catch((cause: unknown) => {
      if (!cancelled) setState({ ...EMPTY, status: 'error',
        error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { cancelled = true; };
  }, [enabled, folders, shortcuts, listAllShortcuts, bookmarks]);
  return state;
}
