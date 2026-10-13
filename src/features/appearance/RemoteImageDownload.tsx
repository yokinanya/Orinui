import { useState } from 'react';
import { ArrowUpRightIcon, DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import type { ImageAssetKind } from '@/domain/asset';
import { RedirectConfirmationRequiredError } from '@/domain/remote-image-errors';
import { downloadRemoteImage } from '@/platform/remote-images';
import type { NewImageAsset } from '@/storage/assets';
import { useImageSource } from '@/features/appearance/use-image-source';

interface RemoteImageDownloadProps {
  readonly id: string;
  readonly kind: ImageAssetKind;
  readonly initialSourceUrl?: string | null;
  readonly disabled?: boolean;
  readonly onReady: (image: NewImageAsset) => Promise<void> | void;
  readonly onBusyChange?: (busy: boolean) => void;
}

function useDownloadState({ kind, initialSourceUrl, onReady, onBusyChange }: RemoteImageDownloadProps) {
  const { source, changeSource, acceptSource } = useImageSource(initialSourceUrl);
  const [error, setError] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<RedirectConfirmationRequiredError | null>(null);
  const [busy, setBusy] = useState(false);
  const download = async (nextSource: string) => {
    setError(null);
    setRedirect(null);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const image = await downloadRemoteImage(nextSource, kind);
      await onReady(image);
      acceptSource(image.sourceUrl);
    }
    catch (cause) {
      if (cause instanceof RedirectConfirmationRequiredError) setRedirect(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  const changeUserSource = (value: string) => { changeSource(value); setError(null); setRedirect(null); };
  const confirmRedirect = () => {
    if (!redirect) return;
    acceptSource(redirect.targetUrl);
    void download(redirect.targetUrl);
  };
  return { source, changeSource: changeUserSource, error, redirect, busy, download, confirmRedirect };
}

function RedirectNotice({ redirect }: { readonly redirect: RedirectConfirmationRequiredError }) {
  return (
    <FieldDescription>
      跳转目标：<a href={redirect.targetUrl} target="_blank" rel="noreferrer" className="break-all">{redirect.targetUrl}</a>
    </FieldDescription>
  );
}

function downloadButtonLabel(busy: boolean, redirect: RedirectConfirmationRequiredError | null): string {
  if (busy) return '正在下载…';
  return redirect ? '授权并继续下载' : '下载到本机';
}

export function RemoteImageDownload(props: RemoteImageDownloadProps) {
  const { id, disabled } = props;
  const { source, changeSource, error, redirect, busy, download, confirmRedirect } = useDownloadState(props);
  const unavailable = Boolean(busy || disabled);
  const actionLabel = downloadButtonLabel(busy, redirect);
  const ActionIcon = busy ? LoaderCircleIcon : redirect ? ArrowUpRightIcon : DownloadIcon;
  return (
    <Field data-invalid={error !== null} data-disabled={unavailable}>
      <FieldLabel htmlFor={id}>自定义图片URL</FieldLabel>
      <InputGroup data-disabled={unavailable} data-invalid={error !== null}>
        <InputGroupInput id={id} type="url" value={source} autoComplete="off" disabled={unavailable}
          aria-invalid={error !== null} onChange={(event) => changeSource(event.target.value)} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" aria-label={actionLabel} title={actionLabel}
            disabled={unavailable || source.trim() === ''}
            onClick={() => { if (redirect) confirmRedirect(); else void download(source); }}>
            <ActionIcon aria-hidden="true" className={busy ? 'animate-spin' : undefined} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
      {redirect && <RedirectNotice redirect={redirect} />}
    </Field>
  );
}
