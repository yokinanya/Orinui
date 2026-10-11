import { useEffect, useRef, useState } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ImageAssetKind } from '@/domain/asset';
import { IMAGE_ACCEPT } from '@/domain/image';
import { prepareImage } from '@/platform/images';
import type { NewImageAsset } from '@/storage/assets';

interface ImageUploadProps {
  readonly id: string;
  readonly kind: ImageAssetKind;
  readonly disabled?: boolean;
  readonly onReady: (image: NewImageAsset) => Promise<void> | void;
  readonly onBusyChange?: (busy: boolean) => void;
}

function useImageUpload({ kind, onReady, onBusyChange }: ImageUploadProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    onBusyChange?.(true);
    try {
      const image = await prepareImage({ blob: file, kind });
      if (mounted.current) await onReady(image);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) { setBusy(false); onBusyChange?.(false); }
    }
  };
  return { busy, error, upload };
}

export function ImageUpload(props: ImageUploadProps) {
  const { id, kind, disabled } = props;
  const { busy, error, upload } = useImageUpload(props);
  return (
    <Field data-invalid={error !== null || undefined} data-disabled={busy || disabled || undefined}>
      <FieldLabel htmlFor={id}>{kind === 'background' ? '上传照片' : '上传图标'}</FieldLabel>
      <Input id={id} type="file" accept={IMAGE_ACCEPT} disabled={busy || disabled}
        aria-invalid={error !== null || undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }} />
      <FieldDescription>{busy ? '正在本机处理图片…' : 'JPEG、PNG、WebP 或静态 SVG，原文件最大 10 MiB。图片只保存在本机。'}</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}
