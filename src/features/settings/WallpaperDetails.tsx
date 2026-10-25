import { CheckIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

import { useData } from '@/app/data-context';
import { useMotionPlayback } from '@/app/MotionPlayback';
import type { MediaAsset } from '@/domain/asset';
import type { MotionBackground, PhotoBackground } from '@/domain/appearance';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { BackgroundMaskField } from '@/features/settings/BackgroundMaskField';
import { assetDisplayName, assetLabel } from '@/features/settings/WallpaperCard';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';
import { WallpaperDetailsMenu } from '@/features/settings/WallpaperDetailsMenu';
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

function MaskControl({ background }: { readonly background: MotionBackground }) {
  const { updateAppearance } = useData();
  return <BackgroundMaskField key={background.assetId} dynamic strength={background.maskStrength}
    onUpdate={(maskStrength) => updateAppearance({ background: { ...background, maskStrength } })} />;
}

/** 当前已应用照片的来源与遮罩控件；与详情合并在同一张卡片内。 */
function AppliedPhotoControls({ asset, background }: { readonly asset: MediaAsset; readonly background: PhotoBackground }) {
  const { updateAppearance, setPhotoBackground } = useData();
  return <div className="mt-1 flex flex-col gap-3 border-t border-border/60 pt-3">
    <div className="flex items-end gap-1">
      <div className="min-w-0 flex-1">
        <RemoteImageDownload id="photo-url" kind="background" initialSourceUrl={asset.sourceUrl ?? null}
          onReady={(image) => setPhotoBackground(image)} />
      </div>
      {asset.sourceUrl && <ClearImageSourceButton key={asset.id} assetId={asset.id} sourceUrl={asset.sourceUrl}
        onCleared={() => undefined} iconOnly />}
    </div>
    <BackgroundMaskField key={background.assetId} strength={background.maskStrength}
      onUpdate={(maskStrength) => updateAppearance({ background: { ...background, maskStrength } })} />
  </div>;
}

/** 当前已应用素材的播放、来源与遮罩控件；与详情合并在同一张卡片内。 */
function AppliedBackgroundControls({ asset }: { readonly asset: MediaAsset }) {
  const { settings } = useData();
  const { reducedMotion } = useMotionPlayback();
  const background = settings.appearance.background;
  if (background.kind === 'photo') return <AppliedPhotoControls asset={asset} background={background} />;
  if (background.kind !== 'motion') return null;
  return <div className="mt-1 flex flex-col gap-2 border-t border-border/60 pt-3">
    {reducedMotion && <p className="text-sm text-muted-foreground">已跟随系统减少动态效果；可主动播放。</p>}
    <MaskControl background={background} />
  </div>;
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
    <div className="wallpaper-detail-header flex items-center justify-between gap-2">
      <h3 className="min-w-0 flex-1 truncate text-base font-medium" title={assetDisplayName(asset)}>{assetDisplayName(asset)}</h3>
      {active && <WallpaperStatus />}
      <WallpaperDetailsMenu asset={asset} active={active} busy={busy} onRename={props.onRenameRequest} onDelete={props.onDelete} />
      <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="关闭壁纸详情" onClick={props.onClose}><XIcon /></Button>
    </div>
    <div className="wallpaper-detail-preview relative">
      <WallpaperPreview asset={asset} onDecodeError={() => setPreviewFailed(true)} />
      {active && asset.motion && <div className="wallpaper-playback-control absolute top-2 right-2"><MotionPlaybackButton compact /></div>}
    </div>
    <div className="wallpaper-detail-content flex min-h-0 flex-col gap-3">
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      <fieldset disabled={busy} aria-label="壁纸操作" className="flex flex-col gap-2">
        {!active && <Button type="button" disabled={missingPoster || previewFailed} onClick={() => run(() => props.onActivate(asset.id))}>
          <CheckIcon data-icon="inline-start" />应用壁纸
        </Button>}
        <WallpaperMetadata asset={asset} />
      </fieldset>
      {active && <AppliedBackgroundControls asset={asset} />}
    </div>
  </section>;
}
