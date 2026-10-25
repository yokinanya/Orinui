import { useCallback, useEffect, useState } from 'react';
import type { DataStatus } from '@/app/data-context';
import type { Folder } from '@/domain/folder';
import { createDefaultSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { Database } from '@/storage/db';
import { listFolders } from '@/storage/folders';
import { ensureInitialized } from '@/storage/init';
import { listHomepageShortcuts } from '@/storage/shortcuts';
import { readSettings } from '@/storage/settings';

function useInitialization(db: Database) {
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [settings, setSettings] = useState(createDefaultSettings);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initialized = await ensureInitialized(db);
        const nextFolders = await listFolders(db);
        if (cancelled) return;
        setFolders(nextFolders);
        setSettings(initialized.settings);
        setStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [db]);
  return { status, setStatus, error, setError, folders, setFolders, settings, setSettings };
}

/** 主页网格内容：文件夹与不属于任何文件夹的网站一起读出来。 */
function useHomepageLoader(db: Database) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const loadShortcuts = useCallback(async () => {
    setShortcuts(await listHomepageShortcuts(db));
  }, [db]);
  const loadFolders = useCallback(async () => listFolders(db), [db]);
  return { shortcuts, setShortcuts, loadShortcuts, loadFolders };
}

export function useDataState(db: Database) {
  const state = useInitialization(db);
  const homepage = useHomepageLoader(db);
  const loadFolders = useCallback(async () => {
    const next = await homepage.loadFolders();
    state.setFolders(next);
    state.setSettings(await readSettings(db));
    return next;
  }, [homepage.loadFolders, state.setFolders]);
  const loadShortcuts = useCallback(async () => {
    await homepage.loadShortcuts();
    state.setSettings(await readSettings(db));
  }, [homepage.loadShortcuts, state.setSettings, db]);
  const { status, setError, setStatus } = state;
  useEffect(() => {
    if (status !== 'ready') return;
    void loadShortcuts().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
    });
  }, [status, loadShortcuts, setError, setStatus]);
  return { ...state, shortcuts: homepage.shortcuts, loadFolders, loadShortcuts };
}