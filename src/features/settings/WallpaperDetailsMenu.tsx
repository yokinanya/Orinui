import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { MediaAsset } from '@/domain/asset';
import { AssetDeleteDialog } from '@/features/settings/WallpaperCard';

export function WallpaperDetailsMenu({ asset, active, busy, onRename, onDelete }: {
  readonly asset: MediaAsset;
  readonly active: boolean;
  readonly busy: boolean;
  readonly onRename: (asset: MediaAsset) => void;
  readonly onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="壁纸更多操作" />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onRename(asset)}><PencilIcon />重命名</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}><Trash2Icon />删除壁纸素材</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <AssetDeleteDialog asset={asset} active={active} open={deleting} onOpenChange={setDeleting} onDelete={onDelete} />
  </>;
}
