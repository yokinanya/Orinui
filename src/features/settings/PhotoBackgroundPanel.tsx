import { useData } from '@/app/data-context';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { notifyError } from '@/lib/notify';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { useLocalImage } from '@/hooks/use-local-image';

const MASK_PERCENT_MAX = 100;

export function PhotoBackgroundPanel() {
  const { settings, setPhotoBackground, updateAppearance } = useData();
  const background = settings.appearance.background;
  const image = useLocalImage(background.kind === 'photo' ? background.assetId : null);
  return (
    <FieldGroup>
      <ImageUpload id="photo-upload" kind="background" onReady={setPhotoBackground} />
      <RemoteImageDownload id="photo-url" kind="background" onReady={setPhotoBackground} />
      {background.kind === 'photo' && (
        <>
          <ClearImageSourceButton key={background.assetId} assetId={background.assetId} sourceUrl={image.sourceUrl} />
          <Field>
            <FieldLabel htmlFor="photo-mask">照片遮罩强度（%）</FieldLabel>
            <Input id="photo-mask" type="number" min={0} max={MASK_PERCENT_MAX}
              value={Math.round(background.maskStrength * MASK_PERCENT_MAX)}
              onChange={(event) => {
                if (event.target.value === '') return;
                const percent = event.target.valueAsNumber;
                void updateAppearance({ background: { ...background, maskStrength: percent / MASK_PERCENT_MAX } }).catch(notifyError);
              }} />
            <FieldDescription>提高强度可增强文字可读性。浅色主题使用浅色遮罩，深色主题使用深色遮罩。</FieldDescription>
          </Field>
        </>
      )}
    </FieldGroup>
  );
}
