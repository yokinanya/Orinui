import type { CSSProperties, FormEvent, MutableRefObject, RefObject } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import type { SearchCustomization } from '@/domain/search-customization';
import type { SearchEngine } from '@/domain/search-engines';
import { SearchEnginePicker } from '@/features/search/SearchEnginePicker';
import { SearchSuggestionList } from '@/features/search/SearchSuggestionList';
import { handleSearchKeyboard } from '@/features/search/search-keyboard';
import type { SearchSuggestion } from '@/features/search/search-model';

const CORNER_RADII = { small: '0.5rem', standard: '1rem', pill: '1.5rem' } as const;
const PERCENT = 100;
const AUTO_SURFACE = 'var(--home-readable-search-surface, var(--glass))';

export interface SearchFormProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly root: RefObject<HTMLFormElement | null>;
  readonly query: string;
  readonly onChange: (value: string) => void;
  readonly onFocus: () => void;
  readonly onDismiss: () => void;
  readonly select: (id: string | null) => void;
  readonly composing: MutableRefObject<boolean>;
  readonly suppressSubmit: MutableRefObject<boolean>;
  readonly showing: boolean;
  readonly suggestions: readonly SearchSuggestion[];
  readonly activeIndex: number;
  readonly execute: (item?: SearchSuggestion) => void;
  readonly customization: SearchCustomization;
  readonly engineId: string;
  readonly engines: readonly SearchEngine[];
  readonly setDefaultEngine: (id: string) => Promise<void>;
}

function searchStyle(settings: SearchCustomization): CSSProperties {
  return { borderRadius: CORNER_RADII[settings.corner], backgroundColor: settings.surfaceOpacity === null
    ? AUTO_SURFACE : `rgb(from ${AUTO_SURFACE} r g b / ${settings.surfaceOpacity / PERCENT})` };
}

function submitSearch(event: FormEvent<HTMLFormElement>, input: SearchFormProps): void {
  event.preventDefault();
  if (input.composing.current || input.suppressSubmit.current) { input.suppressSubmit.current = false; return; }
  if (input.showing && input.query.trim()) input.execute();
}

export function SearchForm(input: SearchFormProps) {
  const active = input.suggestions[input.activeIndex];
  return <form ref={input.root} role="search" className="relative z-40 w-full" onSubmit={(event) => submitSearch(event, input)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) input.onDismiss(); }}>
    <InputGroup className="home-readable-surface h-12 backdrop-blur-md" style={searchStyle(input.customization)}>
      <InputGroupInput ref={input.inputRef} value={input.query} onFocus={input.onFocus}
        onKeyDown={(event) => handleSearchKeyboard({ event, query: input.query, showing: input.showing,
          activeIndex: input.activeIndex, itemIds: input.suggestions.map(({ id }) => id), composing: input.composing,
          suppressSubmit: input.suppressSubmit, select: input.select, change: input.onChange, dismiss: input.onDismiss,
          execute: () => input.execute() })}
        onCompositionStart={() => { input.composing.current = true; }}
        onCompositionEnd={() => { input.composing.current = false; }}
        onChange={(event) => input.onChange(event.target.value)} placeholder={input.customization.placeholder}
        aria-label="搜索" aria-autocomplete="list" aria-expanded={input.showing}
        aria-controls={input.showing ? 'search-suggestions' : undefined}
        aria-activedescendant={input.showing && active ? `search-option-${active.id}` : undefined}
        className="home-readable-ink h-12 pr-1 text-base text-glass-foreground placeholder:text-glass-foreground-muted md:text-base" />
      <InputGroupAddon className="pl-2"><SearchEnginePicker engineId={input.engineId}
        engines={input.engines} setDefaultEngine={input.setDefaultEngine} /></InputGroupAddon>
    </InputGroup>
    {input.showing && <SearchSuggestionList input={input} />}
  </form>;
}
