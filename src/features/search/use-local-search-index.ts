import { useEffect, useState } from 'react';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { buildLocalSearchIndex, type LocalSearchItem } from '@/domain/local-search';

interface IndexState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly items: readonly LocalSearchItem[];
  readonly error: string | null;
}

interface IndexInput {
  readonly enabled: boolean;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly listAllShortcuts: () => Promise<Shortcut[]>;
}

async function readSearchIndex(input: IndexInput): Promise<readonly LocalSearchItem[]> {
  const [shortcuts, { pinyin }] = await Promise.all([input.listAllShortcuts(), import('pinyin-pro')]);
  return buildLocalSearchIndex({ shortcuts, folders: input.folders, transliterate: (text) => ({
    full: pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join(''),
    initials: pinyin(text, { pattern: 'first', type: 'array', nonZh: 'consecutive' }).join(''),
  }) });
}

/** 索引只在本地内容改变时重建；首次使用才加载随包拼音词典。 */
export function useLocalSearchIndex(input: IndexInput): IndexState {
  const [state, setState] = useState<IndexState>({ status: 'idle', items: [], error: null });
  const { enabled, folders, shortcuts, listAllShortcuts } = input;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: 'loading', items: [], error: null });
    void readSearchIndex({ enabled, folders, shortcuts, listAllShortcuts }).then((items) => {
      if (!cancelled) setState({ status: 'ready', items, error: null });
    }).catch((cause: unknown) => {
      if (!cancelled) setState({ status: 'error', items: [],
        error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { cancelled = true; };
  }, [enabled, folders, shortcuts, listAllShortcuts]);
  return state;
}
