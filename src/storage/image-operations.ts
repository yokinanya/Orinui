import { DEFAULT_PHOTO_MASK } from '@/domain/image';
import { createMediaAsset, type NewMediaAsset } from '@/storage/assets';
import type { Database } from '@/storage/db';
import { readSettings, updateSettings } from '@/storage/settings';

export async function setPhotoBackground(db: Database, input: NewMediaAsset): Promise<void> {
  if (input.kind !== 'background') throw new Error('背景需要背景图片资源');
  await db.transaction('rw', db.assets, db.settings, db.shortcuts, async () => {
    const asset = await createMediaAsset(db, input);
    await updateSettings(db, (current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        background: { kind: 'photo', assetId: asset.id, maskStrength: DEFAULT_PHOTO_MASK },
      },
    }));
  });
}

export async function setMotionBackground(db: Database, input: NewMediaAsset): Promise<void> {
  if (input.kind !== 'background' || !input.motion || input.sourceUrl != null) {
    throw new Error('动态背景需要本地动态媒体资源');
  }
  await db.transaction('rw', db.assets, db.settings, db.shortcuts, async () => {
    const asset = await createMediaAsset(db, input);
    await updateSettings(db, (current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        background: { kind: 'motion', assetId: asset.id, maskStrength: DEFAULT_PHOTO_MASK },
      },
    }));
  });
}

export async function activateBackgroundAsset(db: Database, id: string): Promise<void> {
  await db.transaction('rw', db.assets, db.settings, async () => {
    const asset = await db.assets.get(id);
    if (!asset || asset.kind !== 'background') throw new Error('壁纸素材不存在');
    await updateSettings(db, (current) => {
      const old = current.appearance.background;
      const maskStrength = old.kind === 'photo' || old.kind === 'motion' ? old.maskStrength : DEFAULT_PHOTO_MASK;
      const background = asset.motion
        ? { kind: 'motion' as const, assetId: asset.id, maskStrength }
        : { kind: 'photo' as const, assetId: asset.id, maskStrength };
      return { ...current, appearance: { ...current.appearance, background } };
    });
  });
}

export async function deleteBackgroundAsset(db: Database, id: string): Promise<void> {
  await db.transaction('rw', db.assets, db.settings, async () => {
    const asset = await db.assets.get(id);
    if (!asset || asset.kind !== 'background') throw new Error('壁纸素材不存在');
    const settings = await readSettings(db);
    const background = settings.appearance.background;
    const active = (background.kind === 'photo' || background.kind === 'motion') && background.assetId === id;
    if (active) await updateSettings(db, (current) => ({
      ...current, appearance: { ...current.appearance, background: { kind: 'default' } },
    }));
    await db.assets.delete(id);
  });
}
