import { useRef, useState } from 'react';
import { useData } from '@/app/data-context';
import { FieldGroup } from '@/components/ui/field';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { BackgroundMaskField } from '@/features/settings/BackgroundMaskField';
import { useLocalImage } from '@/hooks/use-local-image';

export function PhotoBackgroundPanel({ onBusyChange, editing = false, fresh = false }: {
  readonly onBusyChange?: (busy: boolean) => void; readonly editing?: boolean; readonly fresh?: boolean;
}) {
  const { settings, setPhotoBackground, updateAppearance } = useData();
  const background = settings.appearance.background;
  const [clearedSourceAssetId, setClearedSourceAssetId] = useState<string | null>(null);
  const assetId = background.kind === 'photo' ? background.assetId : null;
  const initialAssetId = useRef(assetId);
  const visibleAsset = !fresh || assetId !== initialAssetId.current;
  const image = useLocalImage(visibleAsset ? assetId : null);
  const sourceUrl = assetId === clearedSourceAssetId ? null : image.sourceUrl;
  return <FieldGroup>
    {!editing && <ImageUpload id="photo-upload" kind="background" onReady={setPhotoBackground} onBusyChange={onBusyChange} />}
    {<RemoteImageDownload id="photo-url" kind="background" initialSourceUrl={sourceUrl} onReady={setPhotoBackground}
      onBusyChange={onBusyChange}
      headerAction={assetId ? <ClearImageSourceButton key={assetId} assetId={assetId} sourceUrl={sourceUrl}
        onCleared={() => setClearedSourceAssetId(assetId)} iconOnly /> : undefined} />}
    {background.kind === 'photo' && visibleAsset && <BackgroundMaskField key={background.assetId} strength={background.maskStrength}
      onUpdate={(maskStrength) => updateAppearance({ background: { ...background, maskStrength } })} />}
  </FieldGroup>;
}
