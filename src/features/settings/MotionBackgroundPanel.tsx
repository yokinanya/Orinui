import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useData } from '@/app/data-context';
import { useMotionPlayback } from '@/app/MotionPlayback';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MOTION_ACCEPT } from '@/domain/motion';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';
import { BackgroundMaskField } from '@/features/settings/BackgroundMaskField';
import { prepareMotionMedia } from '@/platform/media';
import { useOperations } from '@/app/operations';

interface MotionPanelProps { readonly onBusyChange: (busy: boolean) => void; readonly editing?: boolean; readonly fresh?: boolean }

function useMotionUpload(onBusyChange: MotionPanelProps['onBusyChange']) {
  const { setMotionBackground } = useData();
  const operations = useOperations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    onBusyChange(true);
    const task = operations.begin('导入动态壁纸', '验证媒体并生成封面');
    try {
      const media = await prepareMotionMedia(file);
      if (mounted.current) await setMotionBackground(media);
      task.succeed('动态壁纸已加入素材库并应用');
    } catch (cause) {
      task.fail(cause);
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  };
  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void upload(file);
  };
  return { busy, error, selectFile };
}

export function MotionBackgroundPanel({ onBusyChange, editing = false, fresh = false }: MotionPanelProps) {
  const { settings, updateAppearance } = useData();
  const { image, reducedMotion } = useMotionPlayback();
  const { busy, error, selectFile } = useMotionUpload(onBusyChange);
  const background = settings.appearance.background;
  const initialAssetId = useRef(background.kind === 'motion' ? background.assetId : null);
  const showAsset = background.kind === 'motion' && (!fresh || background.assetId !== initialAssetId.current);
  return <FieldGroup>
    {!editing && <Field data-invalid={error !== null} data-disabled={busy}>
      <FieldLabel htmlFor="motion-upload">上传动态壁纸</FieldLabel>
      <Input id="motion-upload" type="file" accept={MOTION_ACCEPT} disabled={busy}
        aria-invalid={error !== null} onChange={selectFile} />
      <FieldDescription>{busy ? '正在读取素材并生成封面…' : 'MP4、WebM、GIF 或动态 WebP。视频静音循环，暂停时显示封面。'}</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>}
    {background.kind === 'motion' && showAsset && <>
      {!editing && image.url && <img src={image.url} alt="动态壁纸封面预览" className="aspect-video w-full rounded-xl object-cover" />}
      <MotionPlaybackButton />
      {reducedMotion && <FieldDescription>已跟随系统减少动态效果；可主动播放。</FieldDescription>}
      <BackgroundMaskField key={background.assetId} dynamic strength={background.maskStrength}
        onUpdate={(maskStrength) => updateAppearance({ background: { ...background, maskStrength } })} />
    </>}
  </FieldGroup>;
}
