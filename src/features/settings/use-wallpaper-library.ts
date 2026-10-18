import { useCallback, useEffect, useState } from 'react';
import { useData } from '@/app/data-context';
import { useOperations } from '@/app/operations';
import type { MediaAsset } from '@/domain/asset';

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useWallpaperLibrary() {
  const { settings, listBackgroundAssets, activateBackgroundAsset, deleteBackgroundAsset,
    renameBackgroundAsset, reorderBackgroundAsset } = useData();
  const operations = useOperations();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const background = settings.appearance.background;
  const activeId = background.kind === 'photo' || background.kind === 'motion' ? background.assetId : null;
  const refresh = useCallback(async () => { setAssets(await listBackgroundAssets()); }, [listBackgroundAssets]);

  useEffect(() => {
    let cancelled = false;
    void listBackgroundAssets().then((next) => {
      if (!cancelled) { setAssets(next); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) { setError(messageOf(cause)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [listBackgroundAssets, background]);

  const run = async (label: string, action: () => Promise<unknown>, done: string): Promise<void> => {
    setError(null);
    setBusy(true);
    const task = operations.begin(label, '更新本地壁纸素材库');
    try { await action(); await refresh(); task.succeed(done); }
    catch (cause) { task.fail(cause); setError(messageOf(cause)); throw cause; }
    finally { setBusy(false); }
  };

  return { assets, activeId, error, busy, loading,
    activate: (id: string) => run('切换壁纸', () => activateBackgroundAsset(id), '壁纸已应用'),
    remove: (id: string) => run('删除壁纸素材', () => deleteBackgroundAsset(id), '壁纸素材已删除'),
    rename: (id: string, name: string) => run('重命名壁纸素材', () => renameBackgroundAsset(id, name), '素材名称已保存'),
    reorder: (id: string, targetId: string) => run('调整素材顺序', () => reorderBackgroundAsset(id, targetId), '素材顺序已保存'),
  };
}
