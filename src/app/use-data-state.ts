import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DataStatus } from '@/app/data-context';
import type { Group } from '@/domain/group';
import { createDefaultSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { Database } from '@/storage/db';
import { listGroups } from '@/storage/groups';
import { ensureInitialized } from '@/storage/init';
import { listShortcuts } from '@/storage/shortcuts';

function useInitialization(db: Database) {
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [settings, setSettings] = useState(createDefaultSettings);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initialized = await ensureInitialized(db);
        const nextGroups = await listGroups(db);
        if (cancelled) return;
        setGroups(nextGroups);
        setSettings(initialized.settings);
        setActiveGroupId(initialized.defaultGroup.id);
        setStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [db]);
  return { status, setStatus, error, setError, groups, setGroups, settings, setSettings, activeGroupId, setActiveGroupId };
}

function useShortcutLoader(db: Database, activeGroupId: string | null) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loadedShortcutsGroupId, setLoadedShortcutsGroupId] = useState<string | null>(null);
  const currentGroup = useRef(activeGroupId);
  const request = useRef(0);
  useLayoutEffect(() => { currentGroup.current = activeGroupId; }, [activeGroupId]);
  const loadShortcuts = useCallback(async (groupId: string | null) => {
    if (currentGroup.current !== groupId) return;
    const version = ++request.current;
    try {
      const next = groupId ? await listShortcuts(db, groupId) : [];
      if (request.current !== version || currentGroup.current !== groupId) return;
      setShortcuts(next);
      setLoadedShortcutsGroupId(groupId);
    } catch (cause) {
      // A superseded group request is cancelled; the current request still exposes its failure.
      if (request.current === version && currentGroup.current === groupId) throw cause;
    }
  }, [db]);
  return { shortcuts, loadedShortcutsGroupId, loadShortcuts, currentGroup, request };
}

export function useDataState(db: Database) {
  const state = useInitialization(db);
  const loader = useShortcutLoader(db, state.activeGroupId);
  const setActiveGroupId = useCallback((id: string | null) => {
    loader.currentGroup.current = id;
    loader.request.current += 1;
    state.setActiveGroupId(id);
  }, [loader.currentGroup, loader.request, state.setActiveGroupId]);
  const loadGroups = useCallback(async () => {
    const next = await listGroups(db);
    state.setGroups(next);
    return next;
  }, [db, state.setGroups]);
  const { loadShortcuts } = loader;
  const { activeGroupId, status, setError, setStatus } = state;
  useEffect(() => {
    if (status !== 'ready') return;
    void loadShortcuts(activeGroupId).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
    });
    return () => { loader.request.current += 1; };
  }, [activeGroupId, status, loadShortcuts, setError, setStatus]);
  return { ...state, shortcuts: loader.shortcuts, loadedShortcutsGroupId: loader.loadedShortcutsGroupId,
    setActiveGroupId, loadGroups, loadShortcuts };
}
