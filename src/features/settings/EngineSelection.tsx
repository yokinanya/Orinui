import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BUILT_IN_ENGINES } from '@/domain/search-engines';
import type { SearchEngine } from '@/domain/search-engines';

export function EngineSelection({ engines, selected, onSelect }: {
  readonly engines: readonly SearchEngine[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>默认搜索引擎</FieldLabel>
      <ToggleGroup value={[selected]} className="flex flex-wrap" onValueChange={(values) => {
        if (values[0] && [...BUILT_IN_ENGINES, ...engines].some((engine) => engine.id === values[0])) onSelect(values[0]);
      }}>
        {[...BUILT_IN_ENGINES, ...engines].map((engine) => <ToggleGroupItem key={engine.id} value={engine.id}>{engine.name}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  );
}
