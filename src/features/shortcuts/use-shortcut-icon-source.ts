import { useEffect, useState } from 'react';
import type { useLocalImage } from '@/hooks/use-local-image';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

interface IconSourceInput {
  readonly draft: ShortcutDraft;
  readonly saved: ReturnType<typeof useLocalImage>;
}

/** 已保存图片的来源以资源记录为准；表单保存时同步到网站记录。 */
export function useShortcutIconSource({ draft, saved }: IconSourceInput) {
  const assetId = draft.icon.kind === 'asset' ? draft.icon.assetId : null;
  const [clearedAssetId, setClearedAssetId] = useState<string | null>(null);
  const savedSource = assetId === clearedAssetId ? null : saved.sourceUrl;
  const hasImageDraft = draft.image !== null;
  const sourceUrl = draft.image ? draft.image.sourceUrl ?? null : savedSource;
  const { setIconSourceUrl } = draft;

  useEffect(() => {
    if (!assetId || hasImageDraft || saved.id !== assetId || saved.error) return;
    setIconSourceUrl(savedSource);
  }, [assetId, hasImageDraft, saved.id, saved.error, savedSource, setIconSourceUrl]);

  return { sourceUrl, onCleared: () => setClearedAssetId(assetId) };
}
