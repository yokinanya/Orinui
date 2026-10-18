import { useData } from '@/app/data-context';
import type { HomeLayoutStyle } from '@/domain/layout';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const STYLE_OPTIONS: readonly { readonly id: HomeLayoutStyle; readonly label: string }[] = [
  { id: 'centered', label: '居中留白' },
  { id: 'top-search', label: '顶部工作台' },
  { id: 'left-stack', label: '左侧锚点' },
  { id: 'split', label: '左右分区' },
];

const PREVIEW_BLOCKS: Record<HomeLayoutStyle, readonly string[]> = {
  centered: ['col-start-2 col-span-2 row-start-1', 'col-start-1 col-span-4 row-start-2', 'col-start-1 col-span-4 row-start-3'],
  'top-search': ['col-start-1 row-start-1', 'col-start-2 col-span-2 row-start-1', 'col-start-1 col-span-4 row-start-2 row-span-2'],
  'left-stack': ['col-start-1 row-start-1', 'col-start-1 col-span-2 row-start-2', 'col-start-1 col-span-3 row-start-3'],
  split: ['col-start-1 row-start-1 row-span-2', 'col-start-2 col-span-3 row-start-1', 'col-start-2 col-span-3 row-start-2 row-span-2'],
};

function LayoutSketch({ style }: { readonly style: HomeLayoutStyle }) {
  return (
    <div aria-hidden="true" className="grid h-16 grid-cols-4 grid-rows-3 gap-1.5 rounded-lg bg-muted/40 p-2">
      {PREVIEW_BLOCKS[style].map((block, index) => <span key={index}
        className={cn('rounded-md border border-primary/15 bg-primary/20', block)} />)}
    </div>
  );
}

export function LayoutStylePicker() {
  const { settings, updateLayout } = useData();
  const select = (style: HomeLayoutStyle) => void updateLayout({ style }).catch(notifyError);

  return (
    <section aria-labelledby="layout-style-label" className="flex flex-col gap-2">
      <h4 id="layout-style-label" className="text-sm font-normal text-muted-foreground">主页布局</h4>
      <ToggleGroup className="settings-preview-choices grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
        aria-labelledby="layout-style-label" value={[settings.layout.style]} onValueChange={(values) => {
          const option = STYLE_OPTIONS.find(({ id }) => id === values[0]);
          if (option) select(option.id);
        }}>
        {STYLE_OPTIONS.map(({ id, label }) => (
          <ToggleGroupItem key={id} value={id} aria-label={label}
            className="settings-preview-choice h-auto min-w-0 flex-col items-stretch gap-2 rounded-xl border p-2.5 text-left whitespace-normal">
            <LayoutSketch style={id} />
            <span className="text-sm font-medium">{label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  );
}
