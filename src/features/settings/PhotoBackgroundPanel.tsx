import { useCallback, useEffect, useState } from 'react';
import { useData } from '@/app/data-context';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import type { PhotoBackground } from '@/domain/appearance';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { notifyError } from '@/lib/notify';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { useLocalImage } from '@/hooks/use-local-image';
import { useThrottledEmit } from '@/hooks/use-throttled-emit';

const MASK_PERCENT_MIN = 0;
const MASK_PERCENT_MAX = 100;
const MASK_PERCENT_LARGE_STEP = 10;
const MASK_PERCENT_STEP = 1;

function percentFromSlider(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : value[0] ?? MASK_PERCENT_MIN;
}

function PhotoMaskField({ background, onUpdate }: {
  readonly background: PhotoBackground;
  readonly onUpdate: (background: PhotoBackground) => Promise<void>;
}) {
  const persistedPercent = Math.round(background.maskStrength * MASK_PERCENT_MAX);
  const [percent, setPercent] = useState(persistedPercent);
  const emit = useCallback((value: string) => {
    void onUpdate({ ...background, maskStrength: Number(value) / MASK_PERCENT_MAX }).catch(notifyError);
  }, [background, onUpdate]);
  const { emit: queueUpdate, flush } = useThrottledEmit(emit);

  useEffect(() => setPercent(persistedPercent), [background.assetId, persistedPercent]);

  const preview = (value: number | readonly number[]) => {
    const nextPercent = percentFromSlider(value);
    setPercent(nextPercent);
    queueUpdate(String(nextPercent));
  };
  const commit = (value: number | readonly number[]) => {
    preview(value);
    flush();
  };

  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel id="photo-mask-label">照片遮罩强度（%）</FieldLabel>
        <output aria-label="当前照片遮罩强度" className="text-sm text-muted-foreground tabular-nums">{percent}%</output>
      </div>
      <Slider aria-labelledby="photo-mask-label" value={[percent]} min={MASK_PERCENT_MIN} max={MASK_PERCENT_MAX}
        step={MASK_PERCENT_STEP} largeStep={MASK_PERCENT_LARGE_STEP} onValueChange={preview} onValueCommitted={commit} />
    </Field>
  );
}

function usePhotoBackground() {
  const { settings, setPhotoBackground, updateAppearance } = useData();
  const background = settings.appearance.background;
  const update = useCallback((next: PhotoBackground) => updateAppearance({ background: next }), [updateAppearance]);
  return { background, setPhotoBackground, update };
}

export function PhotoBackgroundPanel({ onBusyChange }: { readonly onBusyChange?: (busy: boolean) => void }) {
  const { background, setPhotoBackground, update } = usePhotoBackground();
  const [clearedSourceAssetId, setClearedSourceAssetId] = useState<string | null>(null);
  const assetId = background.kind === 'photo' ? background.assetId : null;
  const image = useLocalImage(assetId);
  const sourceUrl = assetId === clearedSourceAssetId ? null : image.sourceUrl;
  return (
    <FieldGroup>
      <ImageUpload id="photo-upload" kind="background" onReady={setPhotoBackground} onBusyChange={onBusyChange} />
      <RemoteImageDownload id="photo-url" kind="background" initialSourceUrl={sourceUrl} onReady={setPhotoBackground}
        onBusyChange={onBusyChange}
        headerAction={assetId ? <ClearImageSourceButton key={assetId} assetId={assetId} sourceUrl={sourceUrl}
          onCleared={() => setClearedSourceAssetId(assetId)} iconOnly /> : undefined} />
      {background.kind === 'photo' && (
        <>
          <PhotoMaskField background={background} onUpdate={update} />
        </>
      )}
    </FieldGroup>
  );
}
