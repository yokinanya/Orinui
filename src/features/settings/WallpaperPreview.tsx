import { CheckIcon, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { MediaAsset } from '@/domain/asset';
import { useBlobUrl } from '@/hooks/use-local-image';
import { cn } from '@/lib/utils';

export function WallpaperStatus({ className }: { readonly className?: string }) {
  return <Badge className={className}>
    <CheckIcon aria-hidden="true" />当前壁纸
  </Badge>;
}

export function WallpaperPreview({ asset, thumbnail = false, onDecodeError }: {
  readonly asset: MediaAsset; readonly thumbnail?: boolean; readonly onDecodeError?: () => void;
}) {
  const blob = asset.motion ? asset.motion.poster ?? null : asset.blob;
  const url = useBlobUrl(blob);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const error = !blob ? '动态壁纸封面缺失，请重新上传此素材'
    : url && failedUrl === url ? '壁纸预览解码失败，请检查本地素材' : null;
  const frame = cn('flex aspect-video w-full items-center justify-center overflow-hidden bg-muted/40',
    !thumbnail && 'rounded-xl');
  if (error) return <div className={frame}>
    <div className="flex flex-col items-center gap-2 p-3 text-center text-xs text-destructive" role="alert">
      <ImageIcon className="size-5" aria-hidden="true" />{error}
    </div>
  </div>;
  if (!url) return <Skeleton className={frame} aria-label="正在载入壁纸预览" />;
  return <div className={frame}>
    <img src={url} alt={`${asset.name ?? '壁纸'}封面`} loading={thumbnail ? 'lazy' : 'eager'}
      onError={() => { setFailedUrl(url); onDecodeError?.(); }}
      className={cn('aspect-video w-full', thumbnail ? 'object-cover' : 'object-contain')} />
  </div>;
}
