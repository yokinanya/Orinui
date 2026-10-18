import { ArrowLeftIcon, CheckIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

import type { MediaAsset } from '@/domain/asset';
import { AssetDeleteDialog, assetDisplayName, assetLabel } from '@/features/settings/WallpaperCard';
import { WallpaperPreview, WallpaperStatus } from '@/features/settings/WallpaperPreview';
import { formatBytes } from '@/lib/format-bytes';

interface WallpaperDetailsProps {
  readonly asset: MediaAsset;
  readonly active: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onActivate: (id: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onRenameRequest: (asset: MediaAsset) => void;
}

function WallpaperMetadata({ asset }: { readonly asset: MediaAsset }) {
  const duration = asset.motion?.kind === 'video' && asset.motion.duration !== null
    ? `${Math.round(asset.motion.duration)} 秒` : null;
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
    <div><dt className="text-xs text-muted-foreground">类型</dt><dd>{assetLabel(asset)}</dd></div>
    <div><dt className="text-xs text-muted-foreground">尺寸</dt><dd>{asset.width} × {asset.height}</dd></div>
    <div><dt className="text-xs text-muted-foreground">大小</dt><dd>{formatBytes(asset.blob.size)}</dd></div>
    {duration && <div><dt className="text-xs text-muted-foreground">时长</dt><dd>{duration}</dd></div>}
    <div className="col-span-2 min-w-0"><dt className="text-xs text-muted-foreground">来源</dt>
      <dd className="break-all">{asset.sourceUrl ?? '本地上传'}</dd></div>
  </dl>;
}

export function WallpaperDetails(props: WallpaperDetailsProps) {
  const { asset, active, busy } = props;
  const [previewFailed, setPreviewFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    setActionError(null);
    void action().catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  };
  const missingPoster = Boolean(asset.motion && !asset.motion.poster);
  return <section aria-label="壁纸详情" className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-background p-3">
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={props.onClose}>
        <ArrowLeftIcon data-icon="inline-start" />返回素材列表
      </Button>
      {active && <WallpaperStatus />}
    </div>
    <WallpaperPreview asset={asset} onDecodeError={() => setPreviewFailed(true)} />
    <div className="flex flex-col gap-1">
      <h3 className="break-words text-base font-medium">{assetDisplayName(asset)}</h3>
    </div>
    <Button type="button" disabled={busy || active || missingPoster || previewFailed} onClick={() => run(() => props.onActivate(asset.id))}>
      <CheckIcon data-icon="inline-start" />{active ? '已应用' : '应用壁纸'}
    </Button>
    {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    <WallpaperMetadata asset={asset} />

    <fieldset disabled={busy} aria-label="管理壁纸素材" className="flex flex-wrap items-center gap-1">
      <Button type="button" size="sm" variant="ghost" onClick={() => props.onRenameRequest(asset)}>
        <PencilIcon data-icon="inline-start" />重命名
      </Button>
      <AssetDeleteDialog asset={asset} active={active} onDelete={props.onDelete} />
    </fieldset>
  </section>;
}
