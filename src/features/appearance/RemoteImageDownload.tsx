import { useState } from 'react';
import { DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ImageAssetKind } from '@/domain/asset';
import { downloadRemoteImage } from '@/platform/remote-images';
import type { NewImageAsset } from '@/storage/assets';

interface RemoteImageDownloadProps {
  readonly id: string;
  readonly kind: ImageAssetKind;
  readonly disabled?: boolean;
  readonly onReady: (image: NewImageAsset) => Promise<void> | void;
  readonly onBusyChange?: (busy: boolean) => void;
}

export function RemoteImageDownload({ id, kind, disabled, onReady, onBusyChange }: RemoteImageDownloadProps) {
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setError(null);
    setBusy(true);
    onBusyChange?.(true);
    try { await onReady(await downloadRemoteImage(source, kind)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  return (
    <Field data-invalid={error !== null || undefined} data-disabled={busy || disabled || undefined}>
      <FieldLabel htmlFor={id}>图片 HTTPS 直链</FieldLabel>
      <Input id={id} type="url" value={source} autoComplete="off" disabled={busy || disabled}
        aria-invalid={error !== null || undefined} onChange={(event) => setSource(event.target.value)} />
      <FieldDescription>点击下载时只申请这个来源的网站权限；拒绝重定向。来源地址会保存在本机与备份中。</FieldDescription>
      {error && <FieldError role="alert">{error}</FieldError>}
      <Button type="button" variant="outline" disabled={busy || disabled || source.trim() === ''}
        onClick={() => void download()}>
        <DownloadIcon data-icon="inline-start" />{busy ? '正在下载…' : '下载到本机'}
      </Button>
    </Field>
  );
}
