import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSystemPrefersDark } from '@/app/theme';

import { DataContext, type DataContextValue, type DataStatus } from '@/app/data-context';
import { isDarkActive } from '@/app/apply-appearance';
import { createDefaultSettings, type AppSettings } from '@/domain/settings';
import type { Group } from '@/domain/group';
import type { Shortcut } from '@/domain/shortcut';
import { db } from '@/storage/db';
import { createGroup, deleteGroup, listGroups, moveGroup, renameGroup, reorderGroup } from '@/storage/groups';
import { ensureInitialized } from '@/storage/init';
import { readSettings, updateSettings } from '@/storage/settings';
import {
  createShortcut,
  countShortcutsInGroup,
  deleteShortcut,
  listShortcuts,
  moveShortcut,
  moveShortcutToGroup,
  reorderShortcut,
  restoreShortcut,
  updateShortcut,
  type NewShortcut,
  type ShortcutPatch,
} from '@/storage/shortcuts';

interface DataProviderProps {
  children: ReactNode;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 数据层与界面之间的桥。
 *
 * 写入失败时向上抛出，由表单或提示条决定如何展示；只有初始化失败才会
 * 进入 error 状态，避免把局部错误放大成整页不可用。
 */
export function DataProvider({ children }: DataProviderProps) {
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const systemPrefersDark = useSystemPrefersDark();

  const loadGroups = useCallback(async () => {
    const next = await listGroups(db);
    setGroups(next);
    return next;
  }, []);

  const loadShortcuts = useCallback(async (groupId: string | null) => {
    setShortcuts(groupId ? await listShortcuts(db, groupId) : []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const state = await ensureInitialized(db);
        if (cancelled) return;

        setGroups(await listGroups(db));
        setSettings(state.settings);
        setActiveGroupId(state.defaultGroup.id);
        setStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setError(describeError(cause));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;

    void (async () => {
      try {
        await loadShortcuts(activeGroupId);
      } catch (cause) {
        setError(describeError(cause));
        setStatus('error');
      }
    })();
  }, [activeGroupId, status, loadShortcuts]);

  const refreshSettings = useCallback(async () => {
    setSettings(await readSettings(db));
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      status,
      error,
      groups,
      shortcuts,
      settings,
      activeGroupId,
      setActiveGroupId,
      isDark: isDarkActive(settings.appearance.theme, systemPrefersDark),

      async updateAppearance(patch) {
        await updateSettings(db, (current) => ({
          ...current,
          appearance: { ...current.appearance, ...patch },
        }));
        await refreshSettings();
      },
      async updateLayout(layout) {
        await updateSettings(db, (current) => ({ ...current, layout }));
        await refreshSettings();
      },

      async createShortcut(input: NewShortcut) {
        await createShortcut(db, input);
        await loadShortcuts(input.groupId);
      },
      async updateShortcut(id: string, patch: ShortcutPatch) {
        await updateShortcut(db, id, patch);
        await loadShortcuts(activeGroupId);
      },
      async deleteShortcut(id: string) {
        const removed = await deleteShortcut(db, id);
        await loadShortcuts(activeGroupId);
        return removed;
      },
      async restoreShortcut(shortcut: Shortcut) {
        await restoreShortcut(db, shortcut);
        await loadShortcuts(activeGroupId);
      },
      async moveShortcut(id: string, direction: 'up' | 'down') {
        await moveShortcut(db, id, direction);
        await loadShortcuts(activeGroupId);
      },
      async reorderShortcut(id: string, index: number) {
        await reorderShortcut(db, id, index);
        await loadShortcuts(activeGroupId);
      },
      async moveShortcutToGroup(id: string, groupId: string) {
        await moveShortcutToGroup(db, id, groupId);
        await loadShortcuts(activeGroupId);
      },

      async createGroup(name: string) {
        const created = await createGroup(db, name);
        await loadGroups();
        setActiveGroupId(created.id);
      },
      async renameGroup(id: string, name: string) {
        await renameGroup(db, id, name);
        await loadGroups();
      },
      async deleteGroup(id: string) {
        await deleteGroup(db, id);
        const remaining = await loadGroups();
        if (activeGroupId === id) {
          const fallback = remaining.find((group) => group.isDefault) ?? remaining[0];
          setActiveGroupId(fallback ? fallback.id : null);
        }
        await refreshSettings();
      },
      async moveGroup(id: string, direction: 'up' | 'down') {
        await moveGroup(db, id, direction);
        await loadGroups();
      },
      async reorderGroup(id: string, index: number) {
        await reorderGroup(db, id, index);
        await loadGroups();
      },
      async countShortcutsInGroup(groupId: string) {
        return countShortcutsInGroup(db, groupId);
      },
    }),
    [
      status,
      error,
      groups,
      shortcuts,
      settings,
      activeGroupId,
      loadGroups,
      loadShortcuts,
      refreshSettings,
      systemPrefersDark,
    ],
  );

  return <DataContext value={value}>{children}</DataContext>;
}
