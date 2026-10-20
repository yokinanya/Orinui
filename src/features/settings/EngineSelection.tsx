import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { resolveEngine, resolveEngines } from '@/domain/search-engines';
import type { SearchEngine } from '@/domain/search-engines';
import type { BuiltInEngineOverrides } from '@/domain/search-engines';

export function EngineSelection({ engines, overrides, selected, onSelect }: {
  readonly engines: readonly SearchEngine[];
  readonly overrides: BuiltInEngineOverrides;
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const selectedEngine = resolveEngine(selected, engines, overrides);
  const allEngines = resolveEngines(engines, overrides);
  const labelId = useId();
  return (
    <Field aria-labelledby={labelId}>
      <FieldLabel id={labelId}>默认搜索引擎</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" className="w-full justify-between" aria-label="默认搜索引擎" />}>
          <span className="truncate">{selectedEngine?.name ?? '搜索引擎不存在'}</span>
          <ChevronDown data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width)">
          <DropdownMenuRadioGroup value={selected} onValueChange={(id) => {
            if (allEngines.some((engine) => engine.id === id)) onSelect(id);
          }}>
            {allEngines.map((engine) => <DropdownMenuRadioItem key={engine.id} value={engine.id}>
              {engine.name}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}
