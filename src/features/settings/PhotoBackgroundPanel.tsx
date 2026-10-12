import { useState } from 'react';
import { useData } from '@/app/data-context';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { notifyError } from '@/lib/notify';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { useLocalImage } from '@/hooks/use-local-image';

const MASK_PERCENT_MAX = 100;

export function PhotoBackgroundPanel() {
  const { settings, setPhotoBackground, updateAppearance } = useData();
  const [clearedSourceAssetId, setClearedSourceAssetId] = useState<string | null>(null);
  const background = settings.appearance.background;
  const assetId = background.kind === 'photo' ? background.assetId : null;
  const image = useLocalImage(assetId);
  const sourceUrl = assetId === clearedSourceAssetId ? null : image.sourceUrl;
  return (
    <FieldGroup>
      <ImageUpload id="photo-upload" kind="background" onReady={setPhotoBackground} />
      <RemoteImageDownload id="photo-url" kind="background" initialSourceUrl={sourceUrl} onReady={setPhotoBackground} />
      {background.kind === 'photo' && (
        <>
          <ClearImageSourceButton key={background.assetId} assetId={background.assetId} sourceUrl={sourceUrl}
            onCleared={() => setClearedSourceAssetId(background.assetId)} />
          <Field>
            <FieldLabel htmlFor="photo-mask">照片遮罩强度（%）</FieldLabel>
            <Input id="photo-mask" type="number" min={0} max={MASK_PERCENT_MAX}
              value={Math.round(background.maskStrength * MASK_PERCENT_MAX)}
              onChange={(event) => {
                if (event.target.value === '') return;
                const percent = event.target.valueAsNumber;
                void updateAppearance({ background: { ...background, maskStrength: percent / MASK_PERCENT_MAX } }).catch(notifyError);
              }} />
          </Field>
        </>
      )}
    </FieldGroup>
  );
}
