import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { UploadIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { MediaAssetKind } from '@/domain/asset';
import { IMAGE_ACCEPT } from '@/domain/image';
import { prepareImage } from '@/platform/images';
import type { NewMediaAsset } from '@/storage/assets';

interface ImageUploadProps {
  readonly id: string;
  readonly kind: MediaAssetKind;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly onReady: (image: NewMediaAsset) => Promise<void> | void;
  readonly onBusyChange?: (busy: boolean) => void;
}

type UploadImage = (file: File) => void;

interface UploadButtonProps {
  readonly compact: boolean;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

function handleImageChange(event: ChangeEvent<HTMLInputElement>, upload: UploadImage) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) upload(file);
}

function UploadLabel({ compact, id, label }: { readonly compact: boolean; readonly id: string; readonly label: string }) {
  return compact ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>;
}

function CompactUploadButton({ compact, busy, disabled, onClick }: UploadButtonProps) {
  if (!compact) return null;
  const label = busy ? '正在处理…' : '上传图标';
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} className="min-w-9"
      disabled={busy || disabled} onClick={onClick}>
      <UploadIcon aria-hidden="true" />
    </Button>
  );
}

function UploadDescription({ compact, busy }: { readonly compact: boolean; readonly busy: boolean }) {
  if (compact) return null;
  return <FieldDescription>{busy ? '正在处理…' : '支持 PNG、JPEG、WebP 和静态 SVG；最大 10 MiB。'}</FieldDescription>;
}

function UploadError({ message, compact }: { readonly message: string | null; readonly compact: boolean }) {
  if (!message) return null;
  const className = compact ? 'basis-full min-w-0 whitespace-normal break-words' : undefined;
  return <FieldError role="alert" className={className}>{message}</FieldError>;
}

function fileInputClass(compact: boolean) {
  return compact ? 'hidden' : undefined;
}

function fileInputTabIndex(compact: boolean) {
  return compact ? -1 : undefined;
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
  const { id, kind, disabled, compact = false } = props;
  const { busy, error, upload } = useImageUpload(props);
  const input = useRef<HTMLInputElement>(null);
  const label = kind === 'background' ? '上传照片' : '上传图标';
  return (
    <Field orientation={compact ? 'horizontal' : 'vertical'} className={compact ? 'contents' : undefined}
      data-invalid={error !== null} data-disabled={busy || disabled}>
      <UploadLabel compact={compact} id={id} label={label} />
      <Input ref={input} id={id} type="file" accept={IMAGE_ACCEPT} disabled={busy || disabled}
        aria-label={compact ? '选择图标文件' : label} className={fileInputClass(compact)}
        tabIndex={fileInputTabIndex(compact)}
        aria-invalid={error !== null}
        onChange={(event) => handleImageChange(event, (file) => void upload(file))} />
      <CompactUploadButton compact={compact} busy={busy} disabled={disabled} onClick={() => input.current?.click()} />
      <UploadDescription compact={compact} busy={busy} />
      <UploadError message={error} compact={compact} />
    </Field>
  );
}
