import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon } from 'lucide-react';
import type { RefObject } from 'react';
import { notifyError } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import type { MediaAsset } from '@/domain/asset';
import { assetDisplayName, WallpaperCard } from '@/features/settings/WallpaperCard';

interface GridProps {
  readonly assets: readonly MediaAsset[];
  readonly activeId: string | null;
  readonly selectedId: string | null;
  readonly busy: boolean;
  readonly gridRef: RefObject<HTMLDivElement | null>;
  readonly onSelect: (id: string) => void;
  readonly onReorder: (id: string, targetId: string) => Promise<void>;
}

function SortableCard({ asset, input }: { readonly asset: MediaAsset; readonly input: GridProps }) {
  const sortable = useSortable({ id: asset.id, disabled: input.busy });
  return <div ref={sortable.setNodeRef} data-asset-id={asset.id} className="relative min-w-0"
    style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <WallpaperCard asset={asset} active={asset.id === input.activeId} selected={asset.id === input.selectedId} onSelect={input.onSelect} />
    <Button ref={sortable.setActivatorNodeRef} type="button" variant="secondary" size="icon-xs"
      className="absolute top-2 right-2 touch-none cursor-grab active:cursor-grabbing" disabled={input.busy}
      aria-label={`拖动${assetDisplayName(asset)}排序`} {...sortable.attributes} {...sortable.listeners}>
      <GripVerticalIcon />
    </Button>
  </div>;
}

export function WallpaperSortableGrid(input: GridProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const drop = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) void input.onReorder(String(active.id), String(over.id)).catch(() => {
      // The library operation reports the error in the workspace and operation center.
    });
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
    <SortableContext items={input.assets.map(({ id }) => id)} strategy={rectSortingStrategy}>
      <div ref={input.gridRef} aria-label="壁纸素材列表" className="grid min-w-0 grid-cols-2 gap-3">
        {input.assets.map((asset) => <SortableCard key={asset.id} asset={asset} input={input} />)}
      </div>
    </SortableContext>
  </DndContext>;
}
