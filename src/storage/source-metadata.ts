import type { Database } from '@/storage/db';

/** Clears an image source URL while retaining its Blob and every reference. */
export async function clearImageSourceUrl(db: Database, assetId: string): Promise<void> {
  await db.transaction('rw', db.assets, db.shortcuts, async () => {
    const asset = await db.assets.get(assetId);
    if (!asset) throw new Error('图片资源不存在');
    if (asset.sourceUrl === null) throw new Error('图片没有可清除的来源地址');

    const shortcuts = await db.shortcuts.toArray();
    await db.assets.update(assetId, { sourceUrl: null });
    await db.shortcuts.bulkUpdate(shortcuts
      .filter((shortcut) => shortcut.icon.kind === 'asset' && shortcut.icon.assetId === assetId)
      .map((shortcut) => ({ key: shortcut.id, changes: { iconSourceUrl: null } })));
  });
}
