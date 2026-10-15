import { DEFAULT_PHOTO_MASK } from '@/domain/image';
import { createMediaAsset, pruneUnreferencedAssets, releaseReplacedAsset, type NewMediaAsset } from '@/storage/assets';
import type { Database } from '@/storage/db';
import { readSettings, updateSettings } from '@/storage/settings';

export async function setPhotoBackground(db: Database, input: NewMediaAsset): Promise<void> {
  if (input.kind !== 'background') throw new Error('背景需要背景图片资源');
  await db.transaction('rw', db.assets, db.settings, db.shortcuts, async () => {
    const previous = (await readSettings(db)).appearance.background;
    if (previous.kind === 'photo') await releaseReplacedAsset(db, { id: previous.assetId, background: true });
    const asset = await createMediaAsset(db, input);
    await updateSettings(db, (current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        background: { kind: 'photo', assetId: asset.id, maskStrength: DEFAULT_PHOTO_MASK },
      },
    }));
    await pruneUnreferencedAssets(db);
  });
}

export async function setMotionBackground(db: Database, input: NewMediaAsset): Promise<void> {
  if (input.kind !== 'background' || !input.motion || input.sourceUrl != null) {
    throw new Error('动态背景需要本地动态媒体资源');
  }
  await db.transaction('rw', db.assets, db.settings, db.shortcuts, async () => {
    const previous = (await readSettings(db)).appearance.background;
    if (previous.kind === 'photo' || previous.kind === 'motion') {
      await releaseReplacedAsset(db, { id: previous.assetId, background: true });
    }
    const asset = await createMediaAsset(db, input);
    await updateSettings(db, (current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        background: { kind: 'motion', assetId: asset.id, maskStrength: DEFAULT_PHOTO_MASK },
      },
    }));
    await pruneUnreferencedAssets(db);
  });
}
