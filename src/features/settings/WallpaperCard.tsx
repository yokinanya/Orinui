import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { MediaAsset } from '@/domain/asset';
import { LIMITS } from '@/domain/limits';
import { WallpaperPreview, WallpaperStatus } from '@/features/settings/WallpaperPreview';
import { cn } from '@/lib/utils';
import { useWallpaperDialogAction } from '@/features/settings/use-wallpaper-dialog-action';

export function assetLabel(asset: MediaAsset): string {
  if (asset.motion?.kind === 'video') return asset.mime === 'video/mp4' ? 'MP4 视频' : 'WebM 视频';
  if (asset.motion?.kind === 'animation') return asset.mime === 'image/gif' ? 'GIF 动图' : 'WebP 动图';
  return asset.mime === 'image/jpeg' ? 'JPEG 照片' : `${asset.mime.slice(6).toUpperCase()} 照片`;
}

/** 自定义名称优先；未命名时回退到按格式生成的默认名称。 */
export function assetDisplayName(asset: MediaAsset): string {
  return asset.name ?? assetLabel(asset);
}

interface AssetNameDialogProps {
  readonly asset: MediaAsset;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRename: (id: string, name: string) => Promise<void>;
}

export function AssetNameDialog({ asset, open, onOpenChange, onRename }: AssetNameDialogProps) {
  const [name, setName] = useState(asset.name ?? '');
  const action = useWallpaperDialogAction();
  return <Dialog open={open} onOpenChange={(next) => {
    if (action.busy) return;
    if (next) { setName(asset.name ?? ''); action.clearError(); }
    onOpenChange(next);
  }}>
    <DialogContent className="sm:max-w-sm">
      <form onSubmit={(event) => { event.preventDefault(); void action.run(() => onRename(asset.id, name), () => onOpenChange(false)); }}>
        <DialogHeader>
          <DialogTitle>重命名壁纸素材</DialogTitle>
          <DialogDescription>留空使用默认名称。</DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="wallpaper-asset-name">素材名称</FieldLabel>
            <Input id="wallpaper-asset-name" disabled={action.busy} value={name} maxLength={LIMITS.nameGraphemes} autoFocus
              placeholder={assetLabel(asset)} onChange={(event) => setName(event.target.value)} />
            <FieldDescription>最多 {LIMITS.nameGraphemes} 个字符。</FieldDescription>
          </Field>
        </FieldGroup>
        {action.error && <p role="alert" className="pb-3 text-sm text-destructive">{action.error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={action.busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="submit" disabled={action.busy}>{action.busy ? '正在保存…' : '保存名称'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function AssetDeleteDialog({ asset, active, onDelete }: {
  readonly asset: MediaAsset; readonly active: boolean; readonly onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useWallpaperDialogAction();
  return <AlertDialog open={open} onOpenChange={(next) => {
    if (action.busy) return;
    if (next) action.clearError();
    setOpen(next);
  }}>
    <AlertDialogTrigger render={<Button type="button" size="icon" variant="ghost" aria-label="删除壁纸素材"><Trash2Icon /></Button>} />
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>删除这份壁纸素材？</AlertDialogTitle>
        <AlertDialogDescription>{active
          ? '原件将从本机删除，当前背景会切换为默认中性渐变。下次同步时此素材也会从同步库删除。'
          : '原件将从本机删除，下次同步时此素材也会从同步库删除。'}</AlertDialogDescription>
      </AlertDialogHeader>
      {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={action.busy}>取消</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={action.busy}
          onClick={() => void action.run(() => onDelete(asset.id), () => setOpen(false))}>
          {action.busy ? '正在删除…' : '删除素材'}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

interface WallpaperCardProps {
  readonly asset: MediaAsset;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

export function WallpaperCard({ asset, active, selected, onSelect }: WallpaperCardProps) {
  return <button type="button" aria-label={`查看${assetDisplayName(asset)}详情`} aria-pressed={selected}
    onClick={() => onSelect(asset.id)}
    className={cn('group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      selected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/50')}>
    <div className="relative w-full">
      <WallpaperPreview asset={asset} thumbnail />
      {active && <WallpaperStatus className="absolute left-2 top-2" />}
    </div>
    <div className="flex w-full min-w-0 flex-col gap-1 p-2.5">
      <span className="truncate text-sm font-medium">{assetDisplayName(asset)}</span>
      <span className="text-xs text-muted-foreground">{assetLabel(asset)}</span>
    </div>
  </button>;
}
