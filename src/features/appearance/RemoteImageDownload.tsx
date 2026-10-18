import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRightIcon, LoaderCircleIcon, SaveIcon } from 'lucide-react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import type { MediaAssetKind } from '@/domain/asset';
import { RedirectConfirmationRequiredError } from '@/domain/remote-image-errors';
import { downloadRemoteImage } from '@/platform/remote-images';
import type { NewMediaAsset } from '@/storage/assets';
import { useImageSource } from '@/features/appearance/use-image-source';
import { useOperations } from '@/app/operations';

interface RemoteImageDownloadProps {
  readonly id: string;
  readonly kind: MediaAssetKind;
  readonly initialSourceUrl?: string | null;
  readonly headerAction?: ReactNode;
  readonly disabled?: boolean;
  readonly onReady: (image: NewMediaAsset) => Promise<void> | void;
  readonly onBusyChange?: (busy: boolean) => void;
}

function useDownloadState({ kind, initialSourceUrl, onReady, onBusyChange }: RemoteImageDownloadProps) {
  const operations = useOperations();
  const { source, hasUnsavedSource, changeSource, acceptSource } = useImageSource(initialSourceUrl);
  const [error, setError] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<RedirectConfirmationRequiredError | null>(null);
  const [busy, setBusy] = useState(false);
  const download = async (nextSource: string) => {
    setError(null);
    setRedirect(null);
    setBusy(true);
    onBusyChange?.(true);
    const task = operations.begin('下载网络照片', '申请来源权限并下载图片');
    try {
      const image = await downloadRemoteImage(nextSource, kind);
      task.update('验证图片并保存到本机');
      await onReady(image);
      acceptSource(image.sourceUrl);
      task.succeed('网络照片已保存');
    }
    catch (cause) {
      if (cause instanceof RedirectConfirmationRequiredError) {
        setRedirect(cause);
        task.succeed('等待你确认新的图片来源');
      } else task.fail(cause);
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
  return { source, hasUnsavedSource, changeSource: changeUserSource, error, redirect, busy, download, confirmRedirect };
}

function RedirectNotice({ redirect }: { readonly redirect: RedirectConfirmationRequiredError }) {
  return (
    <FieldDescription>
      跳转目标：<a href={redirect.targetUrl} target="_blank" rel="noreferrer" className="break-all">{redirect.targetUrl}</a>
    </FieldDescription>
  );
}

function downloadButtonLabel(busy: boolean, redirect: RedirectConfirmationRequiredError | null): string {
  if (busy) return '正在保存…';
  return redirect ? '授权并继续保存' : '保存';
}

export function RemoteImageDownload(props: RemoteImageDownloadProps) {
  const { id, disabled, headerAction } = props;
  const { source, hasUnsavedSource, changeSource, error, redirect, busy, download, confirmRedirect } = useDownloadState(props);
  const unavailable = Boolean(busy || disabled);
  const actionLabel = downloadButtonLabel(busy, redirect);
  const ActionIcon = busy ? LoaderCircleIcon : redirect ? ArrowUpRightIcon : SaveIcon;
  return (
    <Field data-invalid={error !== null} data-disabled={unavailable}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FieldLabel htmlFor={id}>自定义图片URL</FieldLabel>
          {hasUnsavedSource && <span role="status" className="text-xs text-muted-foreground">未保存</span>}
        </div>
        {headerAction}
      </div>
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
