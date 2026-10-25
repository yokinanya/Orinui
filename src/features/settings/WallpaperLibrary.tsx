import { WallpaperSortableGrid } from '@/features/settings/WallpaperSortableGrid';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { FieldGroup, FieldTitle } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MediaAsset } from '@/domain/asset';
import { AssetNameDialog } from '@/features/settings/WallpaperCard';
import { WallpaperDetails } from '@/features/settings/WallpaperDetails';

import { useWallpaperLibrary } from '@/features/settings/use-wallpaper-library';
import { useWallpaperSelection } from '@/features/settings/use-wallpaper-selection';

type LibraryFilter = 'all' | 'photo' | 'motion';
const FILTER_OPTIONS = [
  { value: 'all', label: '全部' }, { value: 'photo', label: '照片' }, { value: 'motion', label: '动态' },
] as const;

function matchesFilter(asset: MediaAsset, filter: LibraryFilter): boolean {
  if (filter === 'all') return true;
  return (filter === 'motion') === Boolean(asset.motion);
}

function WallpaperEmpty({ hasAssets }: { readonly hasAssets: boolean }) {
  return <Empty className="border border-dashed border-border/60 py-10">
    <EmptyHeader>
      <EmptyTitle>{hasAssets ? '还没有这类壁纸' : '还没有壁纸'}</EmptyTitle>
      <EmptyDescription>{hasAssets ? '试试其他分类。' : '点击“添加壁纸”上传或下载素材。'}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}

function WallpaperLibraryHeader({ count, filter, onFilter }: {
  readonly count: number; readonly filter: LibraryFilter; readonly onFilter: (filter: LibraryFilter) => void;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex flex-col gap-1"><FieldTitle>壁纸库</FieldTitle>
      <p className="text-xs text-muted-foreground">{count} 份素材</p>
    </div>
    <ToggleGroup value={[filter]} aria-label="筛选壁纸素材" className="settings-segmented gap-1"
      onValueChange={(value) => { if (value[0]) onFilter(value[0] as LibraryFilter); }}>
      {FILTER_OPTIONS.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
    </ToggleGroup>
  </div>;
}

export function WallpaperLibrary({ onCreate, focusCreate = false }: {
  readonly onCreate: () => void; readonly focusCreate?: boolean;
}) {
  const library = useWallpaperLibrary();
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const { selectedId, gridRef, detailRef, select, close, clear } = useWallpaperSelection();
  const [renaming, setRenaming] = useState<MediaAsset | null>(null);
  const visible = library.assets.filter((asset) => matchesFilter(asset, filter));
  const selected = visible.find((asset) => asset.id === selectedId);
  return <FieldGroup className="wallpaper-workspace min-h-0 flex-1 gap-2">
    <div className="grid min-h-0 min-w-0 flex-1 items-start gap-4 md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <section aria-label="壁纸库" className="flex h-full min-h-0 min-w-0 flex-col gap-2">
        <Button autoFocus={focusCreate} type="button" variant="outline" className="self-start" onClick={onCreate}><PlusIcon data-icon="inline-start" />添加壁纸</Button>
        <WallpaperLibraryHeader count={library.assets.length} filter={filter}
          onFilter={(next) => { setFilter(next); clear(); }} />
        {library.error && <p role="alert" className="text-sm text-destructive">{library.error}</p>}
        {library.loading ? <Skeleton className="h-40 w-full rounded-xl" aria-label="正在载入壁纸素材库" />
          : visible.length === 0 ? <WallpaperEmpty hasAssets={library.assets.length > 0} />
            : <div className="wallpaper-library-scroll min-h-0 flex-1 overflow-y-auto pr-1">
              <WallpaperSortableGrid assets={visible} activeId={library.activeId} selectedId={selectedId} busy={library.busy}
                gridRef={gridRef} onSelect={select} onReorder={library.reorder} />
            </div>}

      </section>
      <div ref={detailRef} tabIndex={-1} aria-label="壁纸预览和编辑" className="min-w-0 focus:outline-none">
        {selected ? <WallpaperDetails key={selected.id} asset={selected} active={selected.id === library.activeId}
          busy={library.busy} onClose={close} onActivate={library.activate} onDelete={library.remove}
          onRenameRequest={setRenaming} />
          : <Empty className="min-h-48 rounded-2xl border border-dashed border-border/60">
          <EmptyHeader><EmptyTitle>选择壁纸</EmptyTitle>
            <EmptyDescription>选择仅查看详情，不会更换当前背景。</EmptyDescription></EmptyHeader>
        </Empty>}
      </div>
    </div>
    {renaming && <AssetNameDialog key={renaming.id} asset={renaming} open
      onOpenChange={(open) => { if (!open) setRenaming(null); }} onRename={library.rename} />}
  </FieldGroup>;
}
